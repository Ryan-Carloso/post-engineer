// Streamable HTTP transport for the MCP server (Phase 6, P6-1).
//
// This module wires the same McpServer built by createPostEngineerMcpServer()
// to the SDK's StreamableHTTPServerTransport instead of stdio. No tool is
// added, removed, or changed here: the HTTP endpoint serves exactly the
// tools the stdio server serves, with the same handlers.
//
// Local-only skeleton: the listener binds loopback by default and refuses
// to bind any other host unless --allow-remote is passed explicitly.
// There is NO authentication in this PR — that is P6-2. Even with
// --allow-remote, the endpoint accepts unauthenticated requests, so it
// must only be used on a trusted network until P6-2 lands. The stdio
// default is unchanged: without --http-transport, no port is opened.
//
// Because the endpoint is unauthenticated, it also validates request
// origin and host against DNS rebinding: the SDK's own rebinding
// protection defaults to off and validates nothing without configured
// allowlists, so this module enforces it directly. A request with a
// non-loopback Origin is rejected with 403 (non-browser clients send no
// Origin and are unaffected), and while the listener is bound to
// loopback, a non-loopback Host header is rejected too — a rebinding
// request from a malicious page arrives with the attacker's domain as
// Host, and binding 127.0.0.1 alone does not stop the browser on the
// same machine from reaching it.
//
// The transport is stateless (sessionIdGenerator: undefined): the SDK
// keeps no session state in memory, no Mcp-Session-Id header is issued,
// and no tool state is shared between requests beyond what the protocol
// itself requires. The SDK forbids reusing a stateless transport across
// requests ("Stateless transport cannot be reused across requests"), and
// a server instance can only connect to one transport, so every /mcp
// request builds a fresh server (from the factory) plus a fresh transport
// and closes both when the request ends.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HttpTransportOptions {
  host: string;
  port: number;
  allowRemote: boolean;
}

export interface HttpTransportHandle {
  url: string;
  close(): Promise<void>;
}

// Maximum JSON-RPC request body accepted on /mcp (1 MiB).
const MAX_BODY_BYTES = 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function parsePort(value: string): number {
  // Number('') is 0: without this guard an empty --http-port= or
  // MCP_HTTP_PORT='' would silently bind an ephemeral port instead of
  // failing fast on the invalid value.
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

// Parse the HTTP transport startup options. Returns null unless the
// explicit --http-transport flag is present: the stdio default and the
// legacy --http flag never open a port. Throws on invalid input so the
// process fails fast instead of binding an unintended address.
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
        'This skeleton has no authentication yet (P6-2 adds it): bind loopback, or pass --allow-remote explicitly on a trusted network.',
    );
  }
  return { host, port, allowRemote };
}

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

// Hostname from a Host header: strips a trailing :port, unwraps [::1]
// brackets, and tolerates a bare IPv6 literal (which has several colons
// and no brackets). Returns undefined for a missing or malformed value.
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

// DNS-rebinding guard (see the module header). Non-browser clients send
// no Origin and pass; a browser Origin must name a loopback host. While
// the listener is bound to loopback, the Host header must name one too.
function isAllowedRequest(req: IncomingMessage, options: HttpTransportOptions): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (!LOOPBACK_HOSTS.has(new URL(origin).hostname)) return false;
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
      // Do not return mid-stream: leaving a for-await loop destroys the
      // request stream, which can reset the connection before the 413
      // response flushes. Drain instead (discarding, never storing), and
      // answer 413 after the body ends.
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

// Start the HTTP server. serverFactory builds one McpServer per /mcp
// request (see the stateless note above); the HTTP listener itself holds
// no server or tool state. Serves POST /mcp plus a plain GET /health probe.
export async function serveHttpTransport(
  serverFactory: () => McpServer,
  options: HttpTransportOptions,
): Promise<HttpTransportHandle> {
  if (options.allowRemote) {
    console.error(
      'WARNING: MCP HTTP server bound with --allow-remote but no authentication is configured yet ' +
        '(P6-2 adds OAuth token validation). Do not expose this endpoint beyond a trusted network.',
    );
  }

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
      if (pathname !== '/mcp') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      // Fresh server + transport per request: the SDK's stateless
      // transport cannot be reused, and a server binds to one transport.
      const server = serverFactory();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        // allSettled never rejects, so no rejection handler is needed here.
        void Promise.allSettled([transport.close(), server.close()]);
      };
      res.on('close', cleanup);
      await server.connect(transport);
      if (req.method === 'POST') {
        const parsedBody = await readBody(req, res);
        // readBody already answered 400/413 on failure; res.writableEnded
        // distinguishes that case from a successfully parsed body.
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
      // Guard on headersSent, not writableEnded: if the handler already
      // wrote response headers, writeHead would throw ERR_HTTP_HEADERS_SENT
      // out of this catch and kill the process on an unhandled rejection.
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
