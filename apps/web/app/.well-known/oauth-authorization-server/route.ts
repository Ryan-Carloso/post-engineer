import { NextResponse } from 'next/server';
import { getIssuer } from '@/lib/oauth/config';
import { logger } from '@/lib/logger';

//---------------
// GET /.well-known/oauth-authorization-server — authorization server
// metadata (RFC 8414). Public route, no session.
//---------------

export function authorizationServerMetadata() {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:tools', 'offline_access'],
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(authorizationServerMetadata());
  } catch (error) {
    logger.error('[oauth] authorization server metadata failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OAuth is not configured.' },
      { status: 500 },
    );
  }
}
