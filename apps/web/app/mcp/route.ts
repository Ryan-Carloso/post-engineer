import { NextResponse } from 'next/server';
import { createPostEngineerMcpServer, PostEngineerClient, handleMcpWebRequest } from 'post-engineer-mcp';
import { getIssuer, getMcpResource } from '@/lib/oauth/config';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyAccessToken, type AccessTokenClaims, type OAuthKeyMaterial } from '@/lib/oauth/tokens';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_TOOL_SCOPE = 'mcp:tools';

function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, '');
}

function protectedResourceMetadataUrl(resource: string): string | null {
  try {
    return `${new URL(resource).origin}/.well-known/oauth-protected-resource`;
  } catch {
    return null;
  }
}

function unauthorizedResponse(resource: string, tokenPresented: boolean): NextResponse {
  const params = [
    'Bearer realm="post-engineer-mcp"',
    `resource="${headerSafe(resource)}"`,
  ];
  const metadataUrl = protectedResourceMetadataUrl(resource);
  if (metadataUrl !== null) params.push(`resource_metadata="${headerSafe(metadataUrl)}"`);
  if (tokenPresented) params.push('error="invalid_token"');
  params.push('error_description="A valid OAuth access token is required."');
  return NextResponse.json(
    { error: 'Authentication required.' },
    { status: 401, headers: { 'www-authenticate': params.join(', ') } },
  );
}

function isAllowedOrigin(request: Request, issuer: string): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === issuer;
  } catch {
    return false;
  }
}

function extractBearer(request: Request): { token: string | null; presented: boolean } {
  const authorization = request.headers.get('authorization');
  if (authorization === null) return { token: null, presented: false };
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || parts[1] === '') {
    return { token: null, presented: false };
  }
  const token = parts[1] ?? '';
  if (token.split('.').length !== 3) return { token: null, presented: true };
  return { token, presented: true };
}

async function handleMcpRequest(request: Request): Promise<Response> {
  let resource: string;
  let issuer: string;
  let keys: OAuthKeyMaterial;
  try {
    resource = getMcpResource();
    issuer = getIssuer();
    keys = await getOAuthKeys();
  } catch (error) {
    logger.error(
      '[mcp] OAuth is not configured',
      error instanceof Error ? error : new Error('Unknown OAuth configuration error'),
    );
    return NextResponse.json({ error: 'MCP is not configured.' }, { status: 500 });
  }

  try {
    if (!isAllowedOrigin(request, issuer)) {
      return NextResponse.json({ error: 'Forbidden: non-app origin' }, { status: 403 });
    }

    const preAuthLimited = await applyRateLimit(request, RATE_LIMITS.mcpRemotePreAuth);
    if (preAuthLimited !== null) return preAuthLimited;

    const { token, presented } = extractBearer(request);
    if (token === null) return unauthorizedResponse(resource, presented);
    let claims: AccessTokenClaims;
    try {
      claims = await verifyAccessToken(keys, token, { resource });
    } catch {
      return unauthorizedResponse(resource, true);
    }
    if (!claims.scope.split(' ').includes(MCP_TOOL_SCOPE)) {
      return unauthorizedResponse(resource, true);
    }

    const subjectLimited = await applyRateLimit(request, RATE_LIMITS.mcpRemote, claims.sub);
    if (subjectLimited !== null) return subjectLimited;

    return await handleMcpWebRequest(request, () =>
      createPostEngineerMcpServer(
        new PostEngineerClient({ apiKey: token, suppressVersionHeader: true }),
        'http',
      ),
    );
  } catch (error) {
    logger.error(
      '[mcp] hosted endpoint failed',
      error instanceof Error ? error : new Error('Unknown MCP error'),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
