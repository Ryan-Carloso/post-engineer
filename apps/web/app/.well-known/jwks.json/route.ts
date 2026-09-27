import { NextResponse } from 'next/server';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { logger } from '@/lib/logger';

//---------------
// GET /.well-known/jwks.json — the authorization server's public ES256 keys.
// The remote MCP validates access tokens offline against this JWKS.
// Public route, no session.
//---------------

export async function GET(): Promise<NextResponse> {
  try {
    const keys = await getOAuthKeys();
    return NextResponse.json({ keys: [keys.publicJwk] });
  } catch (error) {
    // Internal key-loading details stay in the server logs — the client
    // only gets a stable, generic error.
    logger.error(
      'Failed to load OAuth signing keys for JWKS',
      error instanceof Error ? error : new Error('Unknown key loading error'),
      { endpoint: '/.well-known/jwks.json' },
    );
    return NextResponse.json({ error: 'Failed to load signing keys.' }, { status: 500 });
  }
}
