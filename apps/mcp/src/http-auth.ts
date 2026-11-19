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
  bearer: string;
}

export interface HttpAuthenticator {
  verify(token: string): Promise<AuthContext>;
}

const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

export function parseHttpAuthOptions(env: NodeJS.ProcessEnv): HttpAuthConfig | null {
  const issuer = env.MCP_OAUTH_ISSUER?.trim().replace(/\/+$/, '');
  const resource = env.MCP_RESOURCE?.trim().replace(/\/+$/, '');
  if (issuer === undefined || issuer === '' || resource === undefined || resource === '') {
    return null;
  }
  const jwksUrl = env.MCP_OAUTH_JWKS_URL?.trim() || `${issuer}/.well-known/jwks.json`;
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

export function bearerTokenPresented(req: IncomingMessage): boolean {
  const authorization = req.headers.authorization;
  if (authorization === undefined) return false;
  const parts = authorization.split(' ');
  return parts.length === 2 && parts[0]?.toLowerCase() === 'bearer' && parts[1] !== '';
}

function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, '');
}

export function protectedResourceMetadataUrl(resource: string): string | null {
  try {
    return `${new URL(resource).origin}/.well-known/oauth-protected-resource`;
  } catch {
    return null;
  }
}

export function unauthorizedHttpResponse(
  res: ServerResponse,
  config: HttpAuthConfig,
  tokenPresented = false,
): void {
  const params = [
    'Bearer realm="post-engineer-mcp"',
    `resource="${headerSafe(config.resource)}"`,
  ];
  const metadataUrl = protectedResourceMetadataUrl(config.resource);
  if (metadataUrl !== null) params.push(`resource_metadata="${headerSafe(metadataUrl)}"`);
  if (tokenPresented) params.push('error="invalid_token"');
  params.push('error_description="A valid OAuth access token is required."');
  res.writeHead(401, {
    'content-type': 'application/json',
    'www-authenticate': params.join(', '),
  });
  res.end(JSON.stringify({ error: 'Authentication required.' }));
}

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
