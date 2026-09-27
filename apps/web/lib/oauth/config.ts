import 'server-only';

//---------------
// Authorization server config. No fallbacks: missing env means failure
// explicitly (repo convention). MCP_OAUTH_PRIVATE_KEY_PEM never goes into a
// tracked .env — it is a deploy secret (Vercel env vars).
//---------------

export const OAUTH_SCOPES = ['mcp:tools', 'offline_access'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export function getMcpResource(): string {
  const resource = process.env.MCP_RESOURCE?.trim();
  if (!resource) {
    throw new Error('MCP_RESOURCE is not defined');
  }
  return resource.replace(/\/+$/, '');
}

export function getIssuer(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is not defined');
  }
  return appUrl.replace(/\/+$/, '');
}

export function getPrivateKeyPem(): string {
  const pem = process.env.MCP_OAUTH_PRIVATE_KEY_PEM;
  if (!pem) {
    throw new Error('MCP_OAUTH_PRIVATE_KEY_PEM is not defined');
  }
  return pem.replace(/\\n/g, '\n');
}

export function normalizeScope(requested: string | null): string[] | null {
  if (!requested) return ['mcp:tools'];
  const parts = requested.split(/\s+/).filter((part) => part.length > 0);
  const allowed = new Set<string>(OAUTH_SCOPES);
  if (parts.length === 0 || !parts.every((part) => allowed.has(part))) return null;
  return [...new Set(parts)];
}
