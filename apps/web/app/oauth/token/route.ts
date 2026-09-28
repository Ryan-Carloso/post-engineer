import { NextResponse } from 'next/server';
import { getOAuthKeys } from '@/lib/oauth/keys';
import {
  verifyAuthorizationCode,
  verifyRefreshToken,
  mintAccessToken,
  mintRefreshToken,
  type RefreshTokenClaims,
} from '@/lib/oauth/tokens';
import { verifyPkceChallenge } from '@/lib/oauth/pkce';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

//---------------
// POST /oauth/token — exchanges code+PKCE for tokens and rotates refresh
// tokens. Public client: no secret (token_endpoint_auth_method none).
// Accepts application/x-www-form-urlencoded (RFC 6749) and
// application/json (modern client practice, e.g. ChatGPT).
//
// Refresh tokens are single-use: every issued token registers its jti in
// the mcp_oauth_refresh_tokens allowlist (migration 0026, identifier only —
// never the token value), and rotation consumes the old jti while
// registering the replacement in one atomic RPC. Replays, unknown or
// expired jtis are rejected with invalid_grant.
//---------------

const ACCESS_TTL_SECONDS = 3600;
// Must stay in sync with the '30d' expiry used by mintRefreshToken.
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function refreshExpiresAtIso(): string {
  return new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
}

function logStoreError(action: string, error: unknown): void {
  logger.error(
    `[oauth/token] refresh token store ${action} failed`,
    error instanceof Error ? error : new Error(String(error)),
  );
}

// Registers a freshly minted refresh token's jti in the allowlist.
// Returns false when the token cannot be tracked — the caller must then
// fail closed and never hand out the untracked token.
async function registerRefreshToken(claims: RefreshTokenClaims): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.rpc('register_mcp_refresh_token', {
      p_jti: claims.jti,
      p_user_id: claims.sub,
      p_client_id: claims.clientId,
      p_resource: claims.resource,
      p_scope: claims.scope,
      p_expires_at: refreshExpiresAtIso(),
    });
    if (error) {
      logStoreError('registration', error);
      return false;
    }
    return true;
  } catch (error) {
    logStoreError('registration', error);
    return false;
  }
}

// Atomically consumes the presented refresh token and registers the
// replacement. Returns true exactly once per jti; concurrent replays race
// here and all but one lose. Throws on store errors (caller maps to
// server_error); returns false for unknown/consumed/expired jtis.
async function rotateRefreshToken(
  oldClaims: RefreshTokenClaims,
  newClaims: RefreshTokenClaims,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc('rotate_mcp_refresh_token', {
    p_old_jti: oldClaims.jti,
    p_new_jti: newClaims.jti,
    p_user_id: oldClaims.sub,
    p_client_id: oldClaims.clientId,
    p_resource: oldClaims.resource,
    p_scope: oldClaims.scope,
    p_expires_at: refreshExpiresAtIso(),
  });
  if (error) {
    logStoreError('rotation', error);
    throw new Error('refresh token store unavailable');
  }
  return data === true;
}

function invalidGrant(description: string): NextResponse {
  return NextResponse.json(
    { error: 'invalid_grant', error_description: description },
    { status: 400 },
  );
}

async function parseBody(request: Request): Promise<Map<string, string> | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return new Map(
      Object.entries(body as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const map = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') map.set(key, value);
  }
  return map;
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthToken);
  if (limited) return limited;

  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const grantType = body.get('grant_type');
  const keys = await getOAuthKeys().catch(() => null);
  if (!keys) {
    logger.error('[oauth/token] OAuth signing keys unavailable');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  if (grantType === 'authorization_code') {
    const code = body.get('code');
    const redirectUri = body.get('redirect_uri');
    const clientId = body.get('client_id');
    const verifier = body.get('code_verifier');
    if (
      typeof code !== 'string' ||
      typeof redirectUri !== 'string' ||
      typeof clientId !== 'string' ||
      typeof verifier !== 'string'
    ) {
      return invalidGrant('code, redirect_uri, client_id and code_verifier are required.');
    }

    const claims = await verifyAuthorizationCode(keys, code).catch(() => null);
    if (!claims || claims.clientId !== clientId || claims.redirectUri !== redirectUri) {
      return invalidGrant('Authorization code is invalid or does not match.');
    }
    if (!verifyPkceChallenge(verifier, claims.codeChallenge, 'S256')) {
      return invalidGrant('PKCE verification failed.');
    }

    const access = await mintAccessToken(keys, {
      sub: claims.sub,
      clientId: claims.clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    const response: Record<string, unknown> = {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      scope: claims.scope,
    };
    if (claims.scope.split(' ').includes('offline_access')) {
      const refreshToken = await mintRefreshToken(keys, {
        sub: claims.sub,
        clientId: claims.clientId,
        scope: claims.scope,
        resource: claims.resource,
      });
      // Register the jti before handing the token out: an untracked token
      // could never be rotated safely, so fail closed instead.
      const refreshClaims = await verifyRefreshToken(keys, refreshToken).catch(() => null);
      if (!refreshClaims || !(await registerRefreshToken(refreshClaims))) {
        return NextResponse.json({ error: 'server_error' }, { status: 500 });
      }
      response.refresh_token = refreshToken;
    }
    return NextResponse.json(response);
  }

  if (grantType === 'refresh_token') {
    const token = body.get('refresh_token');
    const clientId = body.get('client_id');
    if (typeof token !== 'string') {
      return invalidGrant('refresh_token is required.');
    }
    const claims = await verifyRefreshToken(keys, token).catch(() => null);
    if (!claims || (typeof clientId === 'string' && claims.clientId !== clientId)) {
      return invalidGrant('Refresh token is invalid.');
    }

    // Mint the replacement first (its jti goes into the atomic rotation),
    // then consume the presented token exactly once.
    const rotated = await mintRefreshToken(keys, {
      sub: claims.sub,
      clientId: claims.clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    const rotatedClaims = await verifyRefreshToken(keys, rotated).catch(() => null);
    if (!rotatedClaims) {
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }

    let rotationAccepted: boolean;
    try {
      rotationAccepted = await rotateRefreshToken(claims, rotatedClaims);
    } catch (error) {
      logStoreError('rotation', error);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    if (!rotationAccepted) {
      // Unknown, expired, or already consumed (replayed) refresh token.
      return invalidGrant('Refresh token has already been used or expired.');
    }

    const access = await mintAccessToken(keys, {
      sub: claims.sub,
      clientId: claims.clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    return NextResponse.json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      scope: claims.scope,
      refresh_token: rotated,
    });
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
}
