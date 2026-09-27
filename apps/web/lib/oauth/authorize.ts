import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMcpResource, normalizeScope } from './config';
import { resolveClient, type ResolvedOAuthClient } from './resolve-client';

//---------------
// Validation of GET /oauth/authorize (OAuth 2.1 + RFC 8707).
// Untrusted client_id/redirect_uri → 400 error without redirect (there is
// no safe place to return to). Other errors → redirect with
// error/error_description for the client to handle.
//---------------

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scope: string[];
  resource: string;
  state: string;
  codeChallenge: string;
}

export type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams; client: ResolvedOAuthClient }
  | { ok: false; error: string; description?: string; redirectUri?: string; state?: string };

export function buildErrorRedirect(
  redirectUri: string,
  error: string,
  state?: string,
  description?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

export async function parseAuthorizeRequest(
  requestUrl: URL,
  supabase: SupabaseClient,
): Promise<AuthorizeValidation> {
  const params = requestUrl.searchParams;
  const clientId = params.get('client_id');
  if (!clientId) {
    return { ok: false, error: 'client_id is required.' };
  }

  const client = await resolveClient(clientId, supabase);
  if (!client) {
    return { ok: false, error: 'Unknown client.' };
  }

  const redirectUri = params.get('redirect_uri');
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: 'redirect_uri is not registered for this client.' };
  }

  const state = params.get('state') ?? '';
  const fail = (error: string, description?: string): AuthorizeValidation => ({
    ok: false,
    error,
    description,
    redirectUri,
    state,
  });

  if (params.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported.');
  }

  const codeChallenge = params.get('code_challenge');
  if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request', 'code_challenge with method S256 is required.');
  }

  const resource = params.get('resource');
  const expectedResource = getMcpResource();
  if (resource !== expectedResource) {
    return fail('invalid_target', `resource must be ${expectedResource}.`);
  }

  const scope = normalizeScope(params.get('scope'));
  if (!scope) {
    return fail('invalid_scope', 'Unsupported scope requested.');
  }

  if (!state) {
    return fail('invalid_request', 'state is required.');
  }

  return {
    ok: true,
    params: { clientId, redirectUri, scope, resource, state, codeChallenge },
    client,
  };
}
