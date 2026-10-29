// OAuth authentication for the MCP HTTP endpoint (Phase 6, P6-2).
//
// The endpoint reuses the web authorization server's tokens: a client
// presents a Bearer ES256 JWT minted by /oauth/token, and this module
// verifies it OFFLINE against the published JWKS — the design the
// web's jwks.json comment already anticipates ("The remote MCP
// validates access tokens offline against this JWKS"). The checks
// mirror the web's verifyAccessToken (apps/web/lib/oauth/tokens.ts):
// issuer, audience = MCP resource, ES256 only, token_use = access,
// plus the P6-2 scope rule: the scope list must include mcp:tools.
// An authorization code, a refresh token, an API key, or a token for
// another resource is never accepted here, even if its signature is
// valid — type confusion between token kinds is exactly what
// token_use exists to prevent.
//
// Per-subject isolation: verification returns the token's subject, and
// the HTTP layer builds the per-request MCP server with that subject's
// bearer forwarded to the web API (which resolves OAuth bearers to
// the same subject). No tool state is shared between requests, and
// the bearer is never logged: authentication failures return null
// and the caller answers 401 without ever printing the token.
//
// Auth is configured only when MCP_OAUTH_ISSUER and MCP_RESOURCE are
// both set. Without them the transport keeps its P6-1 behaviour
// (loopback only, unauthenticated); with them, every /mcp request
// must authenticate, loopback included — an authenticated endpoint
// that skipped auth for local requests would be a hole, not a
// convenience. A non-loopback bind without auth configured is
// refused at startup (see http-transport.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface HttpAuthConfig {
  issuer: string;
  resource: string;
  jwksUrl: string;
  rateLimitPerMinute: number;
}

export interface AuthContext {
  sub: string;
  clientId: string;
  /** The verified bearer, forwarded to the web API for this request. */
  bearer: string;
}

export interface HttpAuthenticator {
  verify(token: string): Promise<AuthContext>;
}

// Default per-subject rate limit for the remote endpoint: 120 requests
// per minute, mirroring the web's post-detail profile (120/min) — the
// nearest web profile for a polled read surface. Generation itself is
// additionally limited server-side by the web's video-job profiles, so
// this limit is abuse protection, not spend protection.
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

// Parse the OAuth configuration from the environment. Returns null
// when auth is not configured at all (loopback mode); throws on a
// malformed rate limit so the process fails fast instead of running
// with an unintended limit.
export function parseHttpAuthOptions(env: NodeJS.ProcessEnv): HttpAuthConfig | null {
  const issuer = env.MCP_OAUTH_ISSUER?.trim();
  const resource = env.MCP_RESOURCE?.trim();
  if (issuer === undefined || issuer === '' || resource === undefined || resource === '') {
    return null;
  }
  const jwksUrl = env.MCP_OAUTH_JWKS_URL?.trim() || `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
  const rateLimitRaw = env.MCP_HTTP_RATE_LIMIT_PER_MINUTE?.trim();
  let rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (rateLimitRaw !== undefined && rateLimitRaw !== '') {
    const parsed = Number(rateLimitRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid MCP HTTP rate limit: "${rateLimitRaw}" — pass a positive integer for MCP_HTTP_RATE_LIMIT_PER_MINUTE.`,
      );
    }
    rateLimitPerMinute = parsed;
  }
  return { issuer, resource, jwksUrl, rateLimitPerMinute };
}

function requiredClaim(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Token is missing required claim ${name}.`);
  }
  return value;
}

// Build a verifier bound to one JWKS URL. The remote JWK set caches
// keys (jose's default) so every request does not refetch the JWKS.
export function createHttpAuthenticator(config: HttpAuthConfig): HttpAuthenticator {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  return {
    async verify(token: string): Promise<AuthContext> {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['ES256'],
      });
      if (payload.token_use !== 'access') {
        throw new Error('Unexpected token_use (expected access).');
      }
      const scope = requiredClaim(payload, 'scope');
      if (!scope.split(' ').includes('mcp:tools')) {
        throw new Error('Token scope does not include mcp:tools.');
      }
      return {
        sub: requiredClaim(payload, 'sub'),
        clientId: requiredClaim(payload, 'client_id'),
        bearer: token,
      };
    },
  };
}

// Extract and verify the Bearer token of one request. Returns null for
// a missing header, a non-Bearer scheme, a non-JWT value (an API key
// is not an OAuth token and is never accepted here), or any
// verification failure. Never throws, never logs the token.
export async function authenticateHttpRequest(
  req: IncomingMessage,
  authenticator: HttpAuthenticator,
): Promise<AuthContext | null> {
  const authorization = req.headers.authorization;
  if (authorization === undefined) return null;
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  const token = parts[1];
  if (token === undefined || token === '' || token.split('.').length !== 3) return null;
  try {
    return await authenticator.verify(token);
  } catch {
    return null;
  }
}

// Strip characters that would break out of a quoted header value.
function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, '');
}

// Answer 401 for an unauthenticated /mcp request, with the
// WWW-Authenticate header an MCP-spec client uses to discover the
// authorization server. The body names no tool and no token.
export function unauthorizedHttpResponse(res: ServerResponse, config: HttpAuthConfig): void {
  res.writeHead(401, {
    'content-type': 'application/json',
    'www-authenticate':
      `Bearer realm="post-engineer-mcp", resource="${headerSafe(config.resource)}", ` +
      'error="invalid_token", error_description="A valid OAuth access token is required."',
  });
  res.end(JSON.stringify({ error: 'Authentication required.' }));
}

// RFC 9728 protected-resource metadata for this endpoint: the resource
// itself, the authorization server that issues its tokens, and the
// scopes the endpoint accepts. Served at
// /.well-known/oauth-protected-resource (see http-transport.ts).
export function protectedResourceDocument(config: HttpAuthConfig): {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
} {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ['mcp:tools', 'offline_access'],
  };
}
