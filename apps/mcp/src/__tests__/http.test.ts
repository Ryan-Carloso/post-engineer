import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createPostEngineerHttpServer, startHttpServer } from '../http.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startTestServer(): Promise<string> {
  const server = createPostEngineerHttpServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }
  const { port } = address;
  return `http://127.0.0.1:${port}`;
}

describe('remote HTTP server', () => {
  it('serves public health and documentation routes', async () => {
    const baseUrl = await startTestServer();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const healthMarkdown = await fetch(`${baseUrl}/health.md`);
    expect(healthMarkdown.status).toBe(200);
    expect(healthMarkdown.headers.get('content-type')).toContain('text/markdown');
    expect(await healthMarkdown.text()).toContain('Status: ok');

    const docs = await fetch(`${baseUrl}/docs`);
    expect(docs.status).toBe(200);
    expect(docs.headers.get('content-type')).toContain('text/html');
    expect(await docs.text()).toContain('Post Engineer MCP');

    const docsMarkdown = await fetch(`${baseUrl}/docs.md`);
    expect(docsMarkdown.status).toBe(200);
    expect(await docsMarkdown.text()).toContain('https://mcp.post-engineer.com/');
  });

  it('answers CORS preflight requests', async () => {
    const baseUrl = await startTestServer();

    const response = await fetch(`${baseUrl}/`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('supports HEAD for documentation and advertises OAuth for unauthenticated MCP requests', async () => {
    const baseUrl = await startTestServer();

    const docs = await fetch(`${baseUrl}/docs`, { method: 'HEAD' });
    expect(docs.status).toBe(200);
    expect(await docs.text()).toBe('');

    const mcp = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'tunnel-probe', version: '1.0.0' },
        },
      }),
    });
    expect(mcp.status).toBe(200);
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=');

    const tools = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(tools.status).toBe(401);
    expect(tools.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('returns explicit responses for unsupported public methods and paths', async () => {
    const baseUrl = await startTestServer();

    const health = await fetch(`${baseUrl}/health`, { method: 'POST' });
    expect(health.status).toBe(405);

    const docs = await fetch(`${baseUrl}/docs`, { method: 'POST' });
    expect(docs.status).toBe(405);

    const missing = await fetch(`${baseUrl}/missing`);
    expect(missing.status).toBe(404);

    const rootGet = await fetch(`${baseUrl}/`, {
      headers: { Authorization: 'Bearer user-api-key' },
    });
    expect(rootGet.status).toBe(405);
  });

  it('accepts a user API key and handles MCP initialization', async () => {
    const baseUrl = await startTestServer();

    const response = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer user-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'post-engineer-mcp' } },
    });
  });

  it('starts on the configured port and rejects invalid configuration', async () => {
    const previousPort = process.env.MCP_PORT;
    delete process.env.MCP_PORT;
    await expect(startHttpServer()).rejects.toThrow('MCP_PORT must be configured');

    process.env.MCP_PORT = 'invalid';
    await expect(startHttpServer()).rejects.toThrow('MCP_PORT must be an integer');

    process.env.MCP_PORT = '3199';
    const server = await startHttpServer();
    servers.push(server);

    if (previousPort === undefined) delete process.env.MCP_PORT;
    else process.env.MCP_PORT = previousPort;
  });

  it('serves RFC 9728 protected resource metadata for OAuth discovery', async () => {
    const baseUrl = await startTestServer();

    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('content-type')).toContain('application/json');
    expect(await metadata.json()).toEqual({
      resource: 'https://mcp.post-engineer.com',
      authorization_servers: ['https://post-engineer.com'],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://mcp.post-engineer.com/docs',
    });

    const head = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      method: 'HEAD',
    });
    expect(head.status).toBe(200);

    const post = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      method: 'POST',
    });
    expect(post.status).toBe(405);
  });

  it('rejects cross-origin MCP requests to mitigate DNS rebinding', async () => {
    const baseUrl = await startTestServer();
    const origin = new URL(baseUrl).origin;

    const forged = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer user-api-key',
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: '{}',
    });
    expect(forged.status).toBe(403);

    const sameOrigin = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'same-origin-client', version: '1.0.0' },
        },
      }),
    });
    expect(sameOrigin.status).toBe(200);
  });
});
