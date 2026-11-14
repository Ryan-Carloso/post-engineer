import { NextResponse } from 'next/server';
import { getIssuer, getMcpResource } from '@/lib/oauth/config';
import { logger } from '@/lib/logger';

//---------------
// GET /.well-known/oauth-protected-resource — protected-resource metadata
// (RFC 9728) for the hosted MCP endpoint. A ChatGPT-style client fetches
// this document from the resource's origin to discover the authorization
// server before starting OAuth. Public route, no session.
//---------------

export function protectedResourceMetadata() {
  const resource = getMcpResource();
  const issuer = getIssuer();
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['mcp:tools', 'offline_access'],
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(protectedResourceMetadata());
  } catch (error) {
    // Internal config details stay in the server logs — the client only
    // gets a stable, generic error.
    logger.error(
      '[oauth] protected resource metadata failed',
      error instanceof Error ? error : new Error('Unknown OAuth configuration error'),
    );
    return NextResponse.json({ error: 'OAuth is not configured.' }, { status: 500 });
  }
}
