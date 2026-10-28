import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getPost, getPostMetrics } from '../client-posts.js';
import {
  GetPostMetricsSchema,
  handleGetPost,
  handleGetPostMetrics,
} from '../tools-posts.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  // Same shape as the real withTracking: track, then run the handler.
  withTracking: (toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    mockTrackEvent('mcp_tool_called', { toolName });
    return handler(args);
  },
}));

const HEADERS = { Authorization: 'Bearer test-token' };
const PERSONA = '0b7c2c55-4a3e-4c55-9d7e-1f2a3b4c5d6e';

function fakeClient(request: ReturnType<typeof vi.fn>): PostEngineerClient {
  return {
    request,
    getHeaders: vi.fn().mockReturnValue(HEADERS),
  } as unknown as PostEngineerClient;
}

function textOf(response: unknown): string {
  const content = (response as { content?: unknown }).content as McpToolResponse['content'];
  const block = content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

describe('getPost', () => {
  it('GETs /api/posts/[id] with the id percent-encoded', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, kind: 'slot' });
    await getPost(fakeClient(request), 'batch:s-1:slot:a/b');
    expect(request).toHaveBeenCalledWith(
      '/api/posts/batch%3As-1%3Aslot%3Aa%2Fb',
      { method: 'GET', headers: HEADERS },
      'get post',
    );
  });
});

describe('getPostMetrics', () => {
  it('sends only the window when no filter is set', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, rows: [], truncated: false });
    await getPostMetrics(fakeClient(request), { window: '7d' });
    expect(request).toHaveBeenCalledWith(
      '/api/metrics?window=7d',
      { method: 'GET', headers: HEADERS },
      'get post metrics',
    );
  });

  it('sends every filter under the route parameter names, encoded', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, rows: [], truncated: false });
    await getPostMetrics(fakeClient(request), {
      window: '24h',
      persona: PERSONA,
      account: 'UC-1',
      provider: 'youtube',
      angle: 'hot take & more',
    });
    const path = (request.mock.calls[0] as [string])[0];
    const url = new URL(path, 'https://api.test');
    expect(url.pathname).toBe('/api/metrics');
    expect([...url.searchParams.entries()]).toEqual([
      ['window', '24h'],
      ['persona', PERSONA],
      ['account', 'UC-1'],
      ['provider', 'youtube'],
      ['angle', 'hot take & more'],
    ]);
  });
});

describe('GetPostMetricsSchema', () => {
  it('requires a window of 24h or 7d', () => {
    expect(GetPostMetricsSchema.safeParse({}).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '30d' }).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '24h' }).success).toBe(true);
  });

  it('accepts a uuid or the none sentinel as persona, nothing else', () => {
    expect(GetPostMetricsSchema.safeParse({ window: '7d', persona: PERSONA }).success).toBe(true);
    expect(GetPostMetricsSchema.safeParse({ window: '7d', persona: '^@none' }).success).toBe(true);
    expect(GetPostMetricsSchema.safeParse({ window: '7d', persona: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(GetPostMetricsSchema.safeParse({ window: '7d', provider: 'tiktok' }).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '7d', provider: 'bluesky' }).success).toBe(true);
  });

  it('rejects empty and over-length filters like the route does', () => {
    expect(GetPostMetricsSchema.safeParse({ window: '7d', account: '' }).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '7d', angle: 'a'.repeat(201) }).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '7d', angle: 'a'.repeat(200) }).success).toBe(true);
  });
});

describe('get_post / get_post_metrics handlers', () => {
  it('handleGetPost returns the unified detail', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, kind: 'generation', generation: { id: 'g-1' } });
    const result = await handleGetPost(fakeClient(request), { id: 'g-1' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ success: true, kind: 'generation', generation: { id: 'g-1' } });
  });

  it('handleGetPost maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Post not found.'));
    const result = await handleGetPost(fakeClient(request), { id: 'missing' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error getting post: Post not found.');
  });

  it('handleGetPostMetrics returns rows and truncated', async () => {
    const payload = { success: true, rows: [{ postId: 'p-1', views: 10 }], truncated: false };
    const request = vi.fn().mockResolvedValue(payload);
    const result = await handleGetPostMetrics(fakeClient(request), { window: '24h' });
    expect(JSON.parse(textOf(result))).toEqual(payload);
  });

  it('handleGetPostMetrics maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('window must be 24h or 7d.'));
    const result = await handleGetPostMetrics(fakeClient(request), { window: '24h' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error getting post metrics: window must be 24h or 7d.');
  });
});

describe('registered get_post / get_post_metrics tools', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  async function callTool(name: string, args: Record<string, unknown>, request: ReturnType<typeof vi.fn>) {
    const server = createPostEngineerMcpServer(fakeClient(request));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
    }
  }

  it('get_post calls GET /api/posts/[id] and tracks the call', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, kind: 'slot' });
    const result = await callTool('get_post', { id: 'slot-1' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith('/api/posts/slot-1', { method: 'GET', headers: HEADERS }, 'get post');
    expect(mockTrackEvent).toHaveBeenCalledWith('mcp_tool_called', { toolName: 'get_post' });
  });

  it('get_post_metrics calls GET /api/metrics and tracks the call', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, rows: [], truncated: false });
    const result = await callTool('get_post_metrics', { window: '7d', provider: 'linkedin' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith(
      '/api/metrics?window=7d&provider=linkedin',
      { method: 'GET', headers: HEADERS },
      'get post metrics',
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('mcp_tool_called', { toolName: 'get_post_metrics' });
  });

  it('get_post_metrics rejects a bad persona before any request', async () => {
    const request = vi.fn();
    const result = await callTool('get_post_metrics', { window: '7d', persona: 'nope' }, request);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('persona must be a uuid or ^@none');
    expect(request).not.toHaveBeenCalled();
  });
});
