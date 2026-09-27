import 'server-only';

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

export async function fetchCimdDocument(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CimdDocument | null> {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  let response: Response;
  try {
    response = await fetchImpl(clientId, {
      headers: { Accept: 'application/json' },
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
