import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import {
  MCP_CALL_ID_HEADER,
  MCP_TOOL_HEADER,
  MCP_VERSION_HEADER,
  mcpTelemetryHeaders,
  withTracking,
} from '../analytics.js';
import { PostEngineerClient } from '../client.js';

//---------------
// MCP tool telemetry travels to the web API as request headers: the web
// records mcp_tool_called against the authenticated user. These tests pin
// the header contract and the per-invocation context isolation.
//---------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('mcpTelemetryHeaders', () => {
  it('outside a tool call sends only the server version', () => {
    expect(mcpTelemetryHeaders()).toEqual({ [MCP_VERSION_HEADER]: pkg.version });
  });

  it('inside a tool call adds the tool name and a UUID call id', async () => {
    const wrapped = withTracking('list_personas', async () => mcpTelemetryHeaders());
    const headers = await wrapped({});
    expect(headers[MCP_TOOL_HEADER]).toBe('list_personas');
    expect(headers[MCP_CALL_ID_HEADER]).toMatch(UUID);
    expect(headers[MCP_VERSION_HEADER]).toBe(pkg.version);
  });

  it('keeps the same call id across awaits within one call and a fresh one per call', async () => {
    const wrapped = withTracking('generate_persona_video', async () => {
      const first = mcpTelemetryHeaders()[MCP_CALL_ID_HEADER];
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [first, mcpTelemetryHeaders()[MCP_CALL_ID_HEADER]];
    });
    const [a1, a2] = await wrapped({});
    const [b1] = await wrapped({});
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
  });

  it('never mixes concurrent tool calls', async () => {
    const slow = withTracking('slow_tool', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return mcpTelemetryHeaders()[MCP_TOOL_HEADER];
    });
    const fast = withTracking('fast_tool', async () => mcpTelemetryHeaders()[MCP_TOOL_HEADER]);
    await expect(Promise.all([slow({}), fast({})])).resolves.toEqual(['slow_tool', 'fast_tool']);
    expect(mcpTelemetryHeaders()[MCP_TOOL_HEADER]).toBeUndefined();
  });

  it('returns the handler result and propagates handler errors', async () => {
    const ok = withTracking('upload_media', async (args: { path: string }) => `done:${args.path}`);
    await expect(ok({ path: 'photo.jpg' })).resolves.toBe('done:photo.jpg');
    const failing = withTracking('upload_media', async () => {
      throw new Error('boom');
    });
    await expect(failing({})).rejects.toThrow('boom');
  });
});

describe('PostEngineerClient telemetry headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the tool headers on a real API request made inside a tool call', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ personas: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: 'https://api.example.test' });
    await withTracking('list_personas', async () => client.listPersonas())({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers[MCP_TOOL_HEADER]).toBe('list_personas');
    expect(headers[MCP_CALL_ID_HEADER]).toMatch(UUID);
    expect(headers[MCP_VERSION_HEADER]).toBe(pkg.version);
    expect(headers.Authorization).toBe('Bearer pe_test');
  });
});
