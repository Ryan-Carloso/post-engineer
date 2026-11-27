import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMcpResource, normalizeScope } from './config';
import { resolveClient, type ResolvedOAuthClient } from './resolve-client';
import { clientRedirectUrl, redirectUriAllowed, REDIRECT_URI_NOT_ALLOWED } from './redirect-uri';

interface AuthorizeParams {
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
): string | null {
  const url = clientRedirectUrl(redirectUri, { error, error_description: description, state });
  return url === null ? null : url.toString();
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
  if (!redirectUriAllowed(redirectUri)) {
    return { ok: false, error: REDIRECT_URI_NOT_ALLOWED };
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
