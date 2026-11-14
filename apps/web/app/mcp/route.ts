import { NextResponse } from 'next/server';
import { createPostEngineerMcpServer, PostEngineerClient, handleMcpWebRequest } from 'post-engineer-mcp';
import { getIssuer, getMcpResource } from '@/lib/oauth/config';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyAccessToken, type AccessTokenClaims, type OAuthKeyMaterial } from '@/lib/oauth/tokens';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

//---------------
// POST/GET/DELETE /mcp — the hosted remote MCP endpoint (issue #561).
//
// The same deploy as the web API serves the remote (JSON-only) MCP server
// over Streamable HTTP, so a hosted agent (ChatGPT) connects with a URL
// instead of npx. The transport is the MCP package's Web Standard adapter
// (handleMcpWebRequest): stateless, one fresh server per request, 1 MiB
// body cap — the same shape as the standalone node:http listener, minus
// the listener. The per-request server forwards the verified bearer to the
// web API, so the MCP tools run as the token's subject and never as
// another user.
//
// Order mirrors the standalone listener: Origin guard, pre-auth per-IP
// rate limit (before any asymmetric verify), OAuth verification, then the
// per-subject rate limit. The version gate does not apply here: the
// per-request client suppresses X-MCP-Version exactly like the standalone
// HTTP factory, and this endpoint is the deploy itself, not an npx client.
//---------------

const MCP_TOOL_SCOPE = 'mcp:tools';

// Strip characters that would break out of a quoted header value.
// Mirrors headerSafe in apps/mcp/src/http-auth.ts.
function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, '');
}

// The protected-resource metadata URL for a resource identifier, when the
// identifier is a URL: the origin serves the RFC 9728 document at
// /.well-known/oauth-protected-resource. Null for opaque identifiers.
// Mirrors protectedResourceMetadataUrl in apps/mcp/src/http-auth.ts.
function protectedResourceMetadataUrl(resource: string): string | null {
  try {
    return `${new URL(resource).origin}/.well-known/oauth-protected-resource`;
  } catch {
    return null;
  }
}

// Answer 401 for an unauthenticated /mcp request. The WWW-Authenticate
// header carries realm, resource, and (when derivable) resource_metadata
// so an MCP-spec client can discover the authorization server; the
// error="invalid_token" code is included only when a token was actually
// presented (RFC 6750: no error code for a request lacking credentials).
// Mirrors unauthorizedHttpResponse in apps/mcp/src/http-auth.ts.
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

// DNS-rebinding guard, adapted from the standalone listener: a browser
// Origin must name this app's own origin. Non-browser clients send no
// Origin and pass. An unparseable Origin is rejected.
function isAllowedOrigin(request: Request, issuer: string): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === issuer;
  } catch {
    return false;
  }
}

// Extract the Bearer token. Returns the token only when it has the JWT
// shape (three parts); `presented` is true whenever a Bearer value was
// sent at all, even a malformed one, so the 401 challenge can name it.
// Mirrors authenticateHttpRequest + bearerTokenPresented in
// apps/mcp/src/http-auth.ts.
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
    // Load the signing keys up front: without them this endpoint cannot
    // authenticate anyone, so fail loudly instead of answering 401s that
    // could never become 200s.
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
      // Same checks as the standalone verifier (apps/mcp/src/http-auth.ts):
      // issuer, audience = resource, ES256, token_use = access.
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
