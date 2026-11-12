import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { PostEngineerClient } from '../client.js';
import { completeVideoUpload, createVideoUpload, publishUploadedVideo } from '../client-publish-uploaded.js';
import {
  CompleteVideoUploadSchema,
  CreateVideoUploadSchema,
  PublishUploadedVideoSchema,
} from '../publish-uploaded-shape.js';
import { handlePublishUploadedVideo } from '../tools-publish-uploaded.js';
import { createPostEngineerMcpServer } from '../index.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) =>
    handler(args),
}));

function fakeClient(request: ReturnType<typeof vi.fn>): PostEngineerClient {
  return {
    request,
    getHeaders: (includeContentType = true) =>
      includeContentType ? { 'Content-Type': 'application/json' } : {},
  } as unknown as PostEngineerClient;
}

describe('signed-upload schemas are JSON-only', () => {
  it('publish_uploaded_video takes an uploadId and rejects any path field', () => {
    const base = { provider: 'instagram' as const, uploadId: 'up-1', accountIds: ['ig-1'], caption: 'hi' };
    expect(PublishUploadedVideoSchema.safeParse(base).success).toBe(true);
    expect(PublishUploadedVideoSchema.safeParse({ ...base, videoPath: '/tmp/v.mp4' }).success).toBe(false);
    expect(PublishUploadedVideoSchema.safeParse({ ...base, videoPath: '/tmp/v.mp4' }).success).toBe(false);
  });

  it('create_video_upload accepts only video types within the size ceiling', () => {
    expect(CreateVideoUploadSchema.safeParse({ contentType: 'video/mp4', sizeBytes: 10 }).success).toBe(true);
    expect(CreateVideoUploadSchema.safeParse({ contentType: 'image/png', sizeBytes: 10 }).success).toBe(false);
    expect(CreateVideoUploadSchema.safeParse({ contentType: 'video/mp4', sizeBytes: 0 }).success).toBe(false);
    expect(
      CreateVideoUploadSchema.safeParse({ contentType: 'video/mp4', sizeBytes: 3 * 1024 * 1024 * 1024 }).success,
    ).toBe(false);
  });

  it('complete_video_upload requires the uploadId', () => {
    expect(CompleteVideoUploadSchema.safeParse({ uploadId: 'up-1' }).success).toBe(true);
    expect(CompleteVideoUploadSchema.safeParse({}).success).toBe(false);
    expect(CompleteVideoUploadSchema.safeParse({ uploadId: 'up-1', path: '/tmp/v.mp4' }).success).toBe(false);
  });
});

describe('signed-upload client calls', () => {
  it('createVideoUpload posts JSON to the mint endpoint and narrows the reply', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      uploadId: 'up-1',
      signedUrl: 'https://storage.test/upload?token=t',
      token: 'tok',
      expiresAt: '2026-11-12T00:15:00.000Z',
      maxBytes: 2147483648,
    }));
    const minted = await createVideoUpload(fakeClient(request), { contentType: 'video/mp4', sizeBytes: 42 });
    expect(minted.uploadId).toBe('up-1');
    expect(request.mock.calls[0]?.[0]).toBe('/api/videos/upload-url');
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('createVideoUpload fails fast on a bad type or size before any fetch', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({}));
    await expect(createVideoUpload(fakeClient(request), { contentType: 'image/png', sizeBytes: 1 })).rejects.toThrow(
      /contentType/,
    );
    await expect(createVideoUpload(fakeClient(request), { contentType: 'video/mp4', sizeBytes: 0 })).rejects.toThrow(
      /sizeBytes/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('completeVideoUpload posts to the per-upload complete endpoint', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      uploadId: 'up-1',
      status: 'ready',
      contentType: 'video/mp4',
      sizeBytes: 42,
    }));
    const completed = await completeVideoUpload(fakeClient(request), 'up-1');
    expect(completed.status).toBe('ready');
    expect(request.mock.calls[0]?.[0]).toBe('/api/videos/uploads/up-1/complete');
  });

  it('publishUploadedVideo posts JSON by id and narrows per-account results', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      provider: 'instagram',
      results: [{ accountId: 'ig-1', success: true, postId: 'p1' }],
      successCount: 1,
      logId: 'log-1',
    }));
    const result = await publishUploadedVideo(fakeClient(request), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    expect(result.successCount).toBe(1);
    const [path, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    expect(path).toBe('/api/videos/publish-by-id');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({ uploadId: 'up-1', provider: 'instagram', caption: 'hi' });
    expect(body).not.toHaveProperty('videoPath');
  });

  it('publishUploadedVideo fails fast on missing provider fields before any fetch', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({}));
    await expect(
      publishUploadedVideo(fakeClient(request), { provider: 'youtube', uploadId: 'up-1', accountIds: ['c1'] }),
    ).rejects.toThrow(/title is required/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('publish_uploaded_video tool handler', () => {
  it('summarizes per-account results as human text + machine JSON', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      provider: 'instagram',
      results: [{ accountId: 'ig-1', success: true, postId: 'p1' }],
      successCount: 1,
      logId: 'log-1',
    }));
    const response = await handlePublishUploadedVideo(fakeClient(request), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    expect(response.isError).toBeUndefined();
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type === 'text') {
      expect(block.text).toContain('1/1 accounts succeeded');
    }
  });
});

describe('signed-upload tools on both transports', () => {
  async function listTools(transport: 'stdio' | 'http') {
    const server = createPostEngineerMcpServer({} as unknown as PostEngineerClient, transport);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      return tools;
    } finally {
      await client.close();
    }
  }

  it('exposes the JSON-only publish-by-id flow on http with no path field', async () => {
    const tools = await listTools('http');
    const names = tools.map((t) => t.name);
    for (const tool of ['create_video_upload', 'complete_video_upload', 'publish_uploaded_video']) {
      expect(names).toContain(tool);
    }
    const publish = tools.find((t) => t.name === 'publish_uploaded_video');
    expect(publish?.inputSchema.properties).toHaveProperty('uploadId');
    expect(publish?.inputSchema.properties).not.toHaveProperty('videoPath');
    expect(publish?.inputSchema.properties).not.toHaveProperty('path');
  });

  it('keeps publish_video_direct on stdio alongside the new flow', async () => {
    const names = (await listTools('stdio')).map((t) => t.name);
    expect(names).toContain('publish_video_direct');
    expect(names).toContain('publish_uploaded_video');
  });
});
