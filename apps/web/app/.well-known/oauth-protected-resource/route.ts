import { NextResponse } from 'next/server';
import { getIssuer, getMcpResource } from '@/lib/oauth/config';
import { logger } from '@/lib/logger';

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
    logger.error(
      '[oauth] protected resource metadata failed',
      error instanceof Error ? error : new Error('Unknown OAuth configuration error'),
    );
    return NextResponse.json({ error: 'OAuth is not configured.' }, { status: 500 });
  }
}
