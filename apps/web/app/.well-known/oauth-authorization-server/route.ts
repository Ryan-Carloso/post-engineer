import { NextResponse } from 'next/server';
import { getIssuer } from '@/lib/oauth/config';

//---------------
// GET /.well-known/oauth-authorization-server — metadata do authorization
// server (RFC 8414). É o que o ChatGPT/Codex busca após ler o discovery do
// MCP em mcp.post-engineer.com. Rota pública, sem sessão.
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OAuth is not configured.' },
      { status: 500 },
    );
  }
}
