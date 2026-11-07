import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getPost, getPostMetrics, getYouTubeRetentionCurve } from '../client-posts.js';
import {
  GetPostMetricsSchema,
  GetYouTubeRetentionCurveSchema,
  handleGetPost,
  handleGetPostMetrics,
  handleGetYouTubeRetentionCurve,
} from '../tools-posts.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  // Passthrough stand-in for the real withTracking, which only opens the
  // per-call context: mcp_tool_called is recorded by the web API from the
  // request headers, not by the MCP (see analytics.test.ts).
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
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
  it('requires a window of 24h, 7d or 28d', () => {
    expect(GetPostMetricsSchema.safeParse({}).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '30d' }).success).toBe(false);
    expect(GetPostMetricsSchema.safeParse({ window: '24h' }).success).toBe(true);
    expect(GetPostMetricsSchema.safeParse({ window: '28d' }).success).toBe(true);
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

describe('get_youtube_retention_curve', () => {
  it('validates account and video like the route', () => {
    expect(GetYouTubeRetentionCurveSchema.safeParse({ account: 'UC1', video: 'abc-_9' }).success).toBe(true);
    expect(GetYouTubeRetentionCurveSchema.safeParse({ account: '', video: 'abc' }).success).toBe(false);
    expect(GetYouTubeRetentionCurveSchema.safeParse({ account: 'UC1', video: 'a'.repeat(65) }).success).toBe(false);
    expect(GetYouTubeRetentionCurveSchema.safeParse({ account: 'UC1' }).success).toBe(false);
  });

  it('getYouTubeRetentionCurve sends account and video encoded', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, points: [] });
    await getYouTubeRetentionCurve(fakeClient(request), { account: 'UC&1', video: 'v1' });
    expect(request).toHaveBeenCalledWith(
      '/api/metrics/retention-curve?account=UC%261&video=v1',
      { method: 'GET', headers: HEADERS },
      'get YouTube retention curve',
    );
  });

  it('handleGetYouTubeRetentionCurve returns the points and maps failures to an error response', async () => {
    const ok = await handleGetYouTubeRetentionCurve(fakeClient(vi.fn().mockResolvedValue({ success: true, points: [{ ratio: 0.01 }] })), { account: 'UC1', video: 'v1' });
    expect(ok.isError).toBeFalsy();
    expect(textOf(ok)).toContain('"ratio": 0.01');
    const failed = await handleGetYouTubeRetentionCurve(fakeClient(vi.fn().mockRejectedValue(new Error('403 YOUTUBE_ANALYTICS_SCOPE_MISSING'))), { account: 'UC1', video: 'v1' });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toContain('getting YouTube retention curve');
  });
});

describe('registered get_post / get_post_metrics tools', () => {
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

  it('get_post calls GET /api/posts/[id] through the server', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, kind: 'slot' });
    const result = await callTool('get_post', { id: 'slot-1' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith('/api/posts/slot-1', { method: 'GET', headers: HEADERS }, 'get post');
  });

  it('get_post_metrics calls GET /api/metrics through the server', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, rows: [], truncated: false });
    const result = await callTool('get_post_metrics', { window: '7d', provider: 'linkedin' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith(
      '/api/metrics?window=7d&provider=linkedin',
      { method: 'GET', headers: HEADERS },
      'get post metrics',
    );
  });

  it('get_youtube_retention_curve calls GET /api/metrics/retention-curve through the server', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, points: [] });
    const result = await callTool('get_youtube_retention_curve', { account: 'UC own', video: 'vid_1' }, request);
    expect(result.isError).toBeFalsy();
    expect(request).toHaveBeenCalledWith(
      '/api/metrics/retention-curve?account=UC+own&video=vid_1',
      { method: 'GET', headers: HEADERS },
      'get YouTube retention curve',
    );
  });

  it('get_youtube_retention_curve rejects a malformed video id before any request', async () => {
    const request = vi.fn();
    const result = await callTool('get_youtube_retention_curve', { account: 'UC1', video: 'a;b' }, request);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('video must be a YouTube video id');
    expect(request).not.toHaveBeenCalled();
  });

  it('get_post_metrics rejects a bad persona before any request', async () => {
    const request = vi.fn();
    const result = await callTool('get_post_metrics', { window: '7d', persona: 'nope' }, request);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('persona must be a uuid or ^@none');
    expect(request).not.toHaveBeenCalled();
  });
});
