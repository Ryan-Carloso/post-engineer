import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  authenticateHttpRequest,
  bearerTokenPresented,
  createHttpAuthenticator,
  protectedResourceDocument,
  unauthorizedHttpResponse,
  type AuthContext,
  type HttpAuthConfig,
  type HttpAuthenticator,
} from './http-auth.js';
import {
  clientIpKey,
  createHttpRateLimiter,
  createPreAuthIpRateLimiter,
  type HttpRateLimiter,
} from './http-rate-limit.js';

export interface HttpTransportDeps {
  authenticator?: HttpAuthenticator;
  ipRateLimiter?: HttpRateLimiter;
}

export interface HttpTransportOptions {
  host: string;
  port: number;
  allowRemote: boolean;
}

export interface HttpTransportHandle {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function parsePort(value: string): number {
  if (value.trim() === '') {
    throw new Error(
      `Invalid MCP HTTP port: "${value}" — pass --http-port <0-65535> or set MCP_HTTP_PORT.`,
    );
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `Invalid MCP HTTP port: "${value}" — pass --http-port <0-65535> or set MCP_HTTP_PORT.`,
    );
  }
  return port;
}

function flagValue(argv: string[], flag: string, envValue: string | undefined): string | undefined {
  for (const [i, arg] of argv.entries()) {
    if (arg === flag) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag} — pass ${flag} <value>.`);
      }
      return value;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return envValue;
}

export function parseHttpTransportOptions(
  argv: string[],
  env: NodeJS.ProcessEnv,
): HttpTransportOptions | null {
  if (!argv.includes('--http-transport')) {
    return null;
  }
  const host = flagValue(argv, '--host', env.MCP_HTTP_HOST) ?? '127.0.0.1';
  const portValue = flagValue(argv, '--http-port', env.MCP_HTTP_PORT);
  if (portValue === undefined) {
    throw new Error('Missing MCP HTTP port — pass --http-port <port> or set MCP_HTTP_PORT.');
  }
  const port = parsePort(portValue);
  const allowRemote = argv.includes('--allow-remote') || env.MCP_HTTP_ALLOW_REMOTE === 'true';
  if (!isLoopbackHost(host) && !allowRemote) {
    throw new Error(
      `Refusing to bind the MCP HTTP server to non-loopback host "${host}" without --allow-remote. ` +
        'Bind loopback, or pass --allow-remote explicitly; when OAuth is configured, requests are authenticated per request (see http-auth.ts).',
    );
  }
  return { host, port, allowRemote };
}

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function hostHostname(host: string | undefined): string | undefined {
  if (host === undefined || host.length === 0) return undefined;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? undefined : host.slice(1, end);
  }
  const colon = host.indexOf(':');
  if (colon !== -1 && host.indexOf(':', colon + 1) !== -1) return host;
  return colon === -1 ? host : host.slice(0, colon);
}

function isAllowedRequest(req: IncomingMessage, options: HttpTransportOptions): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const originHost = new URL(origin).hostname.replace(/^\[|\]$/g, '');
      if (!LOOPBACK_HOSTS.has(originHost)) return false;
    } catch {
      return false;
    }
  }
  if (isLoopbackHost(options.host)) {
    const hostname = hostHostname(req.headers.host);
    if (hostname === undefined || !LOOPBACK_HOSTS.has(hostname)) return false;
  }
  return true;
}

async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) {
    res.writeHead(413, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request body too large' }));
    return undefined;
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      }),
    );
    return undefined;
  }
}

export async function serveHttpTransport(
  serverFactory: (auth?: AuthContext) => McpServer,
  options: HttpTransportOptions,
  auth: HttpAuthConfig | null = null,
  deps: HttpTransportDeps = {},
): Promise<HttpTransportHandle> {
  if (auth === null) {
    if (!isLoopbackHost(options.host)) {
      throw new Error(
        `Refusing to bind the MCP HTTP server to non-loopback host "${options.host}" without OAuth ` +
          'authentication configured (set MCP_OAUTH_ISSUER and MCP_RESOURCE). Bind loopback, or configure OAuth first.',
      );
    }
    if (options.allowRemote) {
      throw new Error(
        'Refusing to start the MCP HTTP server with --allow-remote without OAuth authentication ' +
          'configured (set MCP_OAUTH_ISSUER and MCP_RESOURCE). An unauthenticated remote endpoint is not allowed.',
      );
    }
  }
  const authenticator = auth === null ? null : (deps.authenticator ?? createHttpAuthenticator(auth));
  const ipRateLimiter: HttpRateLimiter | null =
    auth === null ? null : (deps.ipRateLimiter ?? createPreAuthIpRateLimiter());
  const rateLimiter: HttpRateLimiter | null =
    auth === null
      ? null
      : createHttpRateLimiter({ limit: auth.rateLimitPerMinute, windowMs: 60_000 });

  const httpServer: Server = createServer(async (req, res) => {
    try {
      if (!isAllowedRequest(req, options)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: non-loopback origin or host' }));
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
        if (auth === null) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(protectedResourceDocument(auth)));
        return;
      }
      if (pathname !== '/mcp') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      if (auth !== null && ipRateLimiter !== null) {
        const ipLimited = ipRateLimiter.check(clientIpKey(req));
        if (!ipLimited.allowed) {
          res.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': String(ipLimited.retryAfterSeconds),
          });
          res.end(JSON.stringify({ error: 'Too many requests.' }));
          return;
        }
      }
      let authContext: AuthContext | undefined;
      if (auth !== null && authenticator !== null && rateLimiter !== null) {
        const verified = await authenticateHttpRequest(req, authenticator);
        if (verified === null) {
          unauthorizedHttpResponse(res, auth, bearerTokenPresented(req));
          return;
        }
        const limited = rateLimiter.check(verified.sub);
        if (!limited.allowed) {
          res.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': String(limited.retryAfterSeconds),
          });
          res.end(JSON.stringify({ error: 'Too many requests.' }));
          return;
        }
        authContext = verified;
      }
      const server = serverFactory(authContext);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        void Promise.allSettled([transport.close(), server.close()]);
      };
      res.on('close', cleanup);
      await server.connect(transport);
      if (req.method === 'POST') {
        const parsedBody = await readBody(req, res);
        if (res.writableEnded) {
          cleanup();
          return;
        }
        await transport.handleRequest(req, res, parsedBody);
      } else {
        await transport.handleRequest(req, res);
      }
      cleanup();
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      } else if (!res.writableEnded) {
        res.end();
      }
      console.error('MCP HTTP request failed:', error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => resolve());
  });
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
  const url = `http://${formatHostForUrl(options.host)}:${boundPort}/mcp`;
  return {
    url,
    close: async () => {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
