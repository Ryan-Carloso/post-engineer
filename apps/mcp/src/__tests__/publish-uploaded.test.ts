import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { PostEngineerClient } from '../client.js';
import { completeVideoUpload, createVideoUpload, publishUploadedVideo } from '../client-publish-uploaded.js';
import { ApiError } from '../errors.js';
import {
  CompleteVideoUploadSchema,
  CreateVideoUploadSchema,
  PublishUploadedVideoSchema,
} from '../publish-uploaded-shape.js';
import {
  handleCompleteVideoUpload,
  handleCreateVideoUpload,
  handlePublishUploadedVideo,
} from '../tools-publish-uploaded.js';
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

  it('createVideoUpload rejects a mint body that is missing a signed-upload field', async () => {
    const request = vi.fn(async () => ({ uploadId: 'up-1' }));
    await expect(createVideoUpload(fakeClient(request), { contentType: 'video/quicktime', sizeBytes: 8 })).rejects.toThrow(
      /Malformed signed-upload/,
    );
  });

  it('completeVideoUpload rejects a blank id and a body that is not ready', async () => {
    const request = vi.fn(async () => ({ uploadId: 'up-1', status: 'pending', contentType: 'video/mp4', sizeBytes: 8 }));
    await expect(completeVideoUpload(fakeClient(request), '   ')).rejects.toThrow(/uploadId is required/);
    expect(request).not.toHaveBeenCalled();
    await expect(completeVideoUpload(fakeClient(request), 'up-1')).rejects.toThrow(/Malformed complete-upload/);
  });

  it('publishUploadedVideo narrows optional account fields and defaults a sparse body', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        provider: 'instagram',
        results: [
          {
            accountId: 'ig-1',
            success: true,
            videoId: 'vid',
            videoUrl: 'https://cdn.test/v.mp4',
            permalink: 'https://instagram.test/p/1',
            error: 'ignored',
          },
        ],
        successCount: 1,
        logId: 'log-1',
      })
      .mockResolvedValueOnce({ results: [{ accountId: 'ig-2', success: false }] });
    const full = await publishUploadedVideo(fakeClient(request), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    expect(full.results[0]).toMatchObject({ videoId: 'vid', videoUrl: 'https://cdn.test/v.mp4', permalink: 'https://instagram.test/p/1' });
    expect(full.results[0]).not.toHaveProperty('postId');
    const sparse = await publishUploadedVideo(fakeClient(request), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-2'],
      caption: 'hi',
    });
    expect(sparse).toMatchObject({ success: false, provider: 'unknown', successCount: 0, logId: '' });
    expect(sparse.results[0]).toEqual({ accountId: 'ig-2', success: false });
  });

  it('publishUploadedVideo rejects a malformed body, a bad provider, and empty ids', async () => {
    const request = vi.fn(async (): Promise<unknown> => ({ success: true }));
    await expect(
      publishUploadedVideo(fakeClient(request), { provider: 'instagram', uploadId: 'up-1', accountIds: ['ig-1'], caption: 'hi' }),
    ).rejects.toThrow(/Malformed direct-publish response/);
    request.mockResolvedValueOnce({ results: [null] });
    await expect(
      publishUploadedVideo(fakeClient(request), { provider: 'instagram', uploadId: 'up-1', accountIds: ['ig-1'], caption: 'hi' }),
    ).rejects.toThrow(/Malformed direct-publish account/);
    const idle = vi.fn(async () => ({}));
    await expect(
      publishUploadedVideo(fakeClient(idle), { provider: 'tiktok' as 'instagram', uploadId: 'up-1', accountIds: ['ig-1'], caption: 'hi' }),
    ).rejects.toThrow(/provider must be one of/);
    await expect(
      publishUploadedVideo(fakeClient(idle), { provider: 'instagram', uploadId: '   ', accountIds: ['ig-1'], caption: 'hi' }),
    ).rejects.toThrow(/uploadId is required/);
    await expect(
      publishUploadedVideo(fakeClient(idle), { provider: 'instagram', uploadId: 'up-1', accountIds: [], caption: 'hi' }),
    ).rejects.toThrow(/At least one account ID/);
    expect(idle).not.toHaveBeenCalled();
  });

  it('sends the provider fields that are present and omits the blank ones', async () => {
    const request = vi.fn(async (_path: string, _init?: { body?: string }) => ({
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'c1', success: true }],
      successCount: 1,
      logId: 'log-1',
    }));
    await publishUploadedVideo(fakeClient(request), {
      provider: 'youtube',
      uploadId: 'up-1',
      accountIds: ['c1'],
      title: 'Title',
      description: 'Description',
      tags: ['one'],
      privacyStatus: 'public',
    });
    await publishUploadedVideo(fakeClient(request), {
      provider: 'pinterest',
      uploadId: 'up-1',
      accountIds: ['pin-1'],
      title: 'Pin',
      description: 'About',
      boardId: 'board-1',
    });
    const bodies = request.mock.calls.map((call) => JSON.parse(call[1]?.body ?? '{}') as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ title: 'Title', description: 'Description', tags: ['one'], privacyStatus: 'public' });
    expect(bodies[0]).not.toHaveProperty('caption');
    expect(bodies[0]).not.toHaveProperty('boardId');
    expect(bodies[1]).toMatchObject({ title: 'Pin', description: 'About', boardId: 'board-1' });
    expect(bodies[1]).not.toHaveProperty('tags');
    expect(bodies[1]).not.toHaveProperty('privacyStatus');
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

  it('create and complete handlers return the library text', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/complete')) {
        return { uploadId: 'up-1', status: 'ready', contentType: 'video/mp4', sizeBytes: 8 };
      }
      return {
        uploadId: 'up-1',
        signedUrl: 'https://storage.test/upload?token=t',
        token: 'tok',
        expiresAt: '2026-11-12T00:15:00.000Z',
        maxBytes: 8,
      };
    });
    const created = await handleCreateVideoUpload(fakeClient(request), { contentType: 'video/mp4', sizeBytes: 8 });
    const completed = await handleCompleteVideoUpload(fakeClient(request), { uploadId: 'up-1' });
    expect(created.isError).toBeUndefined();
    expect(completed.isError).toBeUndefined();
    expect(created.content[0]).toMatchObject({ type: 'text' });
    expect(completed.content[0]).toMatchObject({ type: 'text' });
  });

  it('names each link fallback and each failure', async () => {
    const request = vi.fn(async () => ({
      success: false,
      provider: 'instagram',
      results: [
        { accountId: 'a', success: true, videoUrl: 'https://cdn.test/v.mp4' },
        { accountId: 'b', success: true, permalink: 'https://instagram.test/p/1' },
        { accountId: 'c', success: true, postId: 'post-1' },
        { accountId: 'd', success: true, videoId: 'vid-1' },
        { accountId: 'e', success: true },
        { accountId: 'f', success: false, error: 'rate limited' },
        { accountId: 'g', success: false },
      ],
      successCount: 5,
      logId: 'log-1',
    }));
    const response = await handlePublishUploadedVideo(fakeClient(request), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['a'],
      caption: 'hi',
    });
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('published (https://cdn.test/v.mp4)');
    expect(block.text).toContain('published (https://instagram.test/p/1)');
    expect(block.text).toContain('published (post-1)');
    expect(block.text).toContain('published (vid-1)');
    expect(block.text).toContain('- e: published\n');
    expect(block.text).toContain('FAILED — rate limited');
    expect(block.text).toContain('FAILED — unknown error');
  });

  it('returns the machine code for an ApiError and the message otherwise', async () => {
    const coded = vi.fn(async () => {
      throw new ApiError('upload expired', 'UPLOAD_EXPIRED', 'uploadId', 410);
    });
    const codedResponse = await handlePublishUploadedVideo(fakeClient(coded), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    expect(codedResponse.isError).toBe(true);
    const codedText = codedResponse.content[0];
    expect(codedText?.type === 'text' && codedText.text).toContain('"code":"UPLOAD_EXPIRED"');
    expect(codedText?.type === 'text' && codedText.text).toContain('"field":"uploadId"');

    const plain = vi.fn(async () => {
      throw new ApiError('upload expired', null, null);
    });
    const plainResponse = await handlePublishUploadedVideo(fakeClient(plain), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    const plainText = plainResponse.content[0];
    expect(plainResponse.isError).toBe(true);
    expect(plainText?.type === 'text' && plainText.text).toBe('Error publishing uploaded video: upload expired');

    const generic = vi.fn(async () => {
      throw new Error('network down');
    });
    const genericResponse = await handlePublishUploadedVideo(fakeClient(generic), {
      provider: 'instagram',
      uploadId: 'up-1',
      accountIds: ['ig-1'],
      caption: 'hi',
    });
    const genericText = genericResponse.content[0];
    expect(genericText?.type === 'text' && genericText.text).toBe('Error publishing uploaded video: network down');
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

  it('invokes the three signed-upload tools', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/complete')) {
        return { uploadId: 'up-1', status: 'ready', contentType: 'video/mp4', sizeBytes: 8 };
      }
      if (path.includes('publish-by-id')) {
        return {
          success: true,
          provider: 'instagram',
          results: [{ accountId: 'ig-1', success: true, postId: 'p1' }],
          successCount: 1,
          logId: 'log-1',
        };
      }
      return {
        uploadId: 'up-1',
        signedUrl: 'https://storage.test/upload?token=t',
        token: 'tok',
        expiresAt: '2026-11-12T00:15:00.000Z',
        maxBytes: 8,
      };
    });
    const server = createPostEngineerMcpServer(fakeClient(request), 'http');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const created = await client.callTool({ name: 'create_video_upload', arguments: { contentType: 'video/mp4', sizeBytes: 8 } });
      const completed = await client.callTool({ name: 'complete_video_upload', arguments: { uploadId: 'up-1' } });
      const published = await client.callTool({
        name: 'publish_uploaded_video',
        arguments: { provider: 'instagram', uploadId: 'up-1', accountIds: ['ig-1'], caption: 'hi' },
      });
      expect(created.isError).toBeFalsy();
      expect(completed.isError).toBeFalsy();
      expect(published.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});
