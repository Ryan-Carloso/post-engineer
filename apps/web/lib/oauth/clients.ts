import 'server-only';

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';

import { isLocalHostname } from '@/lib/oauth-utils';
import { requestPinned } from '@/lib/ssrf/pinned-request';
import { isPublicIp } from '@/lib/ssrf/public-ip';
import { resolvePublicHost } from '@/lib/ssrf/resolve-public-host';

//---------------
// OAuth clients (RFC 7591 DCR + Client ID Metadata Documents).
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
// Threat model: GET /oauth/authorize takes `client_id` from unauthenticated
// query params and fetchCimdDocument retrieves it server-side, so the
// document fetch must never reach non-public IPs: cloud metadata
// (169.254.169.254), loopback, private ranges, or anything similar.
//---------------

type DnsLookup = (hostname: string) => Promise<LookupAddress[]>;

const defaultLookup: DnsLookup = (hostname) =>
  dnsLookup(hostname, { all: true });

const CIMD_FETCH_TIMEOUT_MS = 8000;
const CIMD_MAX_BYTES = 1024 * 1024;

// True when the address is not a public IP. The table is isPublicIp, the
// same classifier custom-audio and the MCP copy use.
export function isBlockedIpAddress(address: string): boolean {
  return !isPublicIp(address);
}

export async function fetchCimdDocument(
  clientId: string,
  fetchImpl?: typeof fetch,
  lookupImpl: DnsLookup = defaultLookup,
): Promise<CimdDocument | null> {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  // Reject URL forms that are unnecessary for CIMD discovery and increase SSRF surface.
  if (parsed.username || parsed.password) return null;
  if (parsed.hash) return null;
  if (parsed.port && parsed.port !== '443') return null;

  // Resolve the host and refuse non-public IPs before connecting (fail
  // closed when the host does not resolve). The default path then pins the
  // socket to those addresses. fetchImpl is the test seam and still refuses
  // redirects; production callers omit it.
  const safety = await resolvePublicHost(parsed.hostname, (hostname) => lookupImpl(hostname));
  if (!safety.ok) return null;

  const fetchUrl = parsed.toString();
  let response: Response;
  try {
    if (fetchImpl) {
      // codeql[js/request-forgery]: false positive on the injected fetch — the
      // host already passed resolvePublicHost, and redirect is 'error'.
      response = await fetchImpl(fetchUrl, {
        headers: { Accept: 'application/json' },
        // Never follow redirects: a 3xx to an internal URL would otherwise be
        // fetched with the server's network privileges (SSRF).
        redirect: 'error',
        signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      });
    } else {
      // Production path: connect only to the addresses already accepted.
      response = await requestPinned(fetchUrl, safety.addresses, {
        headers: { Accept: 'application/json' },
        timeoutMs: CIMD_FETCH_TIMEOUT_MS,
        maxBytes: CIMD_MAX_BYTES,
      });
    }
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
