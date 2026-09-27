import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createPostEngineerMcpServer } from './index.js';
import { PostEngineerClient } from './client.js';
import { docsHtml, docsMarkdown, healthMarkdown } from './http-docs.js';

const MCP_PATH = '/';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
const DEFAULT_PUBLIC_URL = 'https://mcp.post-engineer.com';
const DEFAULT_AUTHORIZATION_SERVERS = ['https://post-engineer.com'];

function publicBaseUrl(): string {
  const raw = (process.env.MCP_PUBLIC_URL ?? '').trim();
  if (!raw) return DEFAULT_PUBLIC_URL;
  return raw.replace(/\/+$/, '');
}

function authorizationServers(): string[] {
  const raw = (process.env.MCP_AUTHORIZATION_SERVERS ?? '').trim();
  if (!raw) return DEFAULT_AUTHORIZATION_SERVERS;
  return raw
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);
}

function protectedResourceMetadata(): Record<string, unknown> {
  const base = publicBaseUrl();
  return {
    resource: base,
    authorization_servers: authorizationServers(),
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/docs`,
  };
}

function protectedResourceMetadataUrl(): string {
  return `${publicBaseUrl()}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

function unauthorizedChallenge(): string {
  return (
    'Bearer error="invalid_token", ' +
    'error_description="Authentication required.", ' +
    `resource_metadata="${protectedResourceMetadataUrl()}"`
  );
}

function isOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = (request.headers.host ?? '').toLowerCase();
  if (host && originHost === host) return true;
  const extra = (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return extra.includes(originHost);
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be configured for HTTP mode.`);
  }
  return value;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store',
  });
  if (response.req?.method !== 'HEAD') response.end(body);
  else response.end();
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
}

function getPostEngineerApiKey(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;

  const apiKey = authorization.slice('Bearer '.length).trim();
  return apiKey.length > 0 ? apiKey : undefined;
}

function getJsonRpcMethod(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const method = (body as { method?: unknown }).method;
  return typeof method === 'string' ? method : undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  postEngineerApiKey: string | undefined,
  parsedBody?: unknown,
): Promise<void> {
  const server: McpServer = createPostEngineerMcpServer(
    new PostEngineerClient({ apiKey: postEngineerApiKey }),
  );
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  response.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
  } catch (error: unknown) {
    console.error('[mcp/http] request failed', error);
    if (!response.headersSent) {
      writeJson(response, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error.' },
        id: null,
      });
    }
  }
}

export function createPostEngineerHttpServer(): Server {
  return createServer((request, response) => {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/health' || pathname === '/health.md') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeJson(response, 405, { error: 'Only GET and HEAD are supported.' });
        return;
      }
      if (pathname === '/health.md') {
        writeText(response, 200, 'text/markdown', healthMarkdown);
        return;
      }
      writeJson(response, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/docs' || pathname === '/docs.md') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeJson(response, 405, { error: 'Only GET and HEAD are supported.' });
        return;
      }
      if (pathname === '/docs.md') {
        writeText(response, 200, 'text/markdown', docsMarkdown);
        return;
      }
      writeText(response, 200, 'text/html', docsHtml);
      return;
    }

    if (pathname === PROTECTED_RESOURCE_METADATA_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeJson(response, 405, { error: 'Only GET and HEAD are supported.' });
        return;
      }
      const body = JSON.stringify(protectedResourceMetadata());
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      if (request.method !== 'HEAD') response.end(body);
      else response.end();
      return;
    }

    if (pathname !== MCP_PATH) {
      writeJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (!isOriginAllowed(request)) {
      writeJson(response, 403, { error: 'Forbidden origin.' });
      return;
    }

    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'Only POST is supported at /.' });
      return;
    }

    const postEngineerApiKey = getPostEngineerApiKey(request);
    if (postEngineerApiKey) {
      void handleMcpRequest(request, response, postEngineerApiKey);
      return;
    }

    void readJsonBody(request).then((parsedBody: unknown) => {
      if (getJsonRpcMethod(parsedBody) !== 'initialize') {
        response.setHeader('WWW-Authenticate', unauthorizedChallenge());
        writeJson(response, 401, { error: 'Authentication required.' });
        return;
      }
      response.setHeader('WWW-Authenticate', unauthorizedChallenge());
      return handleMcpRequest(request, response, undefined, parsedBody);
    }).catch((error: unknown) => {
      console.error('[mcp/http] request authentication failed', error);
      if (!response.headersSent) writeJson(response, 400, { error: 'Invalid MCP request.' });
      else response.destroy();
    });
  });
}

export async function startHttpServer(): Promise<Server> {
  const portValue = requiredEnvironmentVariable('MCP_PORT');
  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP_PORT must be an integer between 1 and 65535.');
  }

  const httpServer = createPostEngineerHttpServer();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => resolve());
  });

  console.error(`[mcp/http] listening on port ${port}; endpoint path is ${MCP_PATH}`);
  return httpServer;
}
