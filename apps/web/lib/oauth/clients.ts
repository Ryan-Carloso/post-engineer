import 'server-only';

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';

import { isLocalHostname } from '@/lib/oauth-utils';

//---------------
// Clientes OAuth (RFC 7591 DCR + Client ID Metadata Documents).
//
// Two `client_id` formats:
// - `mcp_client_<hex>` — registered via POST /oauth/register, persisted in
//   the database (mcp_oauth_clients table).
// - https URL — Client ID Metadata Document (draft-ietf-oauth-cimd): no
//   state on the server, the document is fetched and `redirect_uris` validated.
//---------------

export interface ValidDcrMetadata {
  ok: true;
  redirectUris: string[];
  clientName: string;
}

export type DcrValidation = ValidDcrMetadata | { ok: false; error: string };

function invalid(error: string): DcrValidation {
  return { ok: false, error };
}

function redirectUriAllowed(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.hash && parsed.hash.length > 0) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:' && isLocalHostname(parsed.hostname)) return true;
  return false;
}

export function validateDcrMetadata(body: unknown): DcrValidation {
  if (typeof body !== 'object' || body === null) {
    return invalid('Request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  const { redirect_uris: redirectUris, client_name: clientName } = record;

  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return invalid('redirect_uris must be a non-empty array.');
  }
  const uris: string[] = [];
  for (const entry of redirectUris) {
    if (typeof entry !== 'string' || !redirectUriAllowed(entry)) {
      return invalid(
        'Each redirect_uri must be https (or http on localhost) without fragment.',
      );
    }
    uris.push(entry);
  }

  let name = 'MCP client';
  if (clientName !== undefined && clientName !== null) {
    if (typeof clientName !== 'string' || clientName.trim().length === 0) {
      return invalid('client_name must be a non-empty string.');
    }
    name = clientName.trim().slice(0, 128);
  }

  return { ok: true, redirectUris: uris, clientName: name };
}

export function isCimdClientId(clientId: string): boolean {
  if (typeof clientId !== 'string' || clientId.length === 0) return false;
  try {
    return new URL(clientId).protocol === 'https:';
  } catch {
    return false;
  }
}

export interface CimdDocument {
  redirect_uris: string[];
}

//---------------
// SSRF guard for outbound fetches to attacker-controlled URLs (CodeQL #17).
// The CIMD client_id comes from the unauthenticated authorize request, so
// the document fetch must never reach non-public IPs: cloud metadata
// (169.254.169.254), loopback, private ranges, or anything similar.
//---------------

type DnsLookup = (hostname: string) => Promise<LookupAddress[]>;

const defaultLookup: DnsLookup = (hostname) =>
  dnsLookup(hostname, { all: true });

// IPv4 networks that must never be fetched server-side, as [network, prefix].
const BLOCKED_IPV4: Array<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 — this network
  [0x0a000000, 8], // 10.0.0.0/8 — private
  [0x64400000, 10], // 100.64.0.0/10 — CGNAT
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local (cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12 — private
  [0xc0000200, 24], // 192.0.2.0/24 — documentation (TEST-NET-1)
  [0xc0a80000, 16], // 192.168.0.0/16 — private
  [0xc6336400, 24], // 198.51.100.0/24 — documentation (TEST-NET-2)
  [0xcb007100, 24], // 203.0.113.0/24 — documentation (TEST-NET-3)
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reserved
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    n = n * 256 + byte;
  }
  return n;
}

/** True when the address is non-public and must never be fetched server-side. */
export function isBlockedIpAddress(address: string): boolean {
  // An IPv6 literal can embed an IPv4 address after the last colon
  // (e.g. ::ffff:127.0.0.1) — check the embedded IPv4 in that case.
  const lastColon = address.lastIndexOf(':');
  const maybeV4 = lastColon >= 0 ? address.slice(lastColon + 1) : address;
  const v4 = ipv4ToInt(maybeV4);
  if (v4 !== null) {
    return BLOCKED_IPV4.some(
      ([network, prefix]) => v4 >>> (32 - prefix) === network >>> (32 - prefix),
    );
  }
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  if (lower.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

export async function fetchCimdDocument(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl: DnsLookup = defaultLookup,
): Promise<CimdDocument | null> {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  // Resolve the host and refuse non-public IPs before fetching (fail closed
  // when the host does not resolve). Residual risk: DNS rebinding between
  // this check and the fetch — the no-redirect fetch below bounds the
  // exposure to a single request against the checked hostname.
  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(parsed.hostname);
  } catch {
    return null;
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isBlockedIpAddress(entry.address))
  ) {
    return null;
  }

  let response: Response;
  try {
    response = await fetchImpl(clientId, {
      headers: { Accept: 'application/json' },
      // Never follow redirects: a 3xx to an internal URL would otherwise be
      // fetched with the server's network privileges (SSRF).
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const uris = (body as Record<string, unknown>).redirect_uris;
  if (!Array.isArray(uris) || !uris.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return { redirect_uris: uris as string[] };
}
