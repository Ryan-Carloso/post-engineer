import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { PostEngineerClient } from '../client.js';
import { publishExisting } from '../client-publish-existing.js';
import { ApiError } from '../errors.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PublishExistingSchema } from '../publish-existing-shape.js';
import { handlePublishExisting } from '../tools-publish-existing.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
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

const TINY_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

const SCHEDULED_TASK = {
  mediaKind: 'task' as const,
  taskId: 'task-1',
  provider: 'instagram' as const,
  accountIds: ['ig-1'],
  title: 'T',
  description: 'D',
  mode: 'scheduled' as const,
  startAt: '2026-11-15T20:00:00',
  times: ['20:00'],
  timezone: 'UTC',
  caption: 'D',
};

const SCHEDULED_REPLY = {
  success: true,
  mode: 'scheduled',
  replayed: false,
  schedule: { id: 'sched-1' },
  slots: [{ id: 'slot-1', slot_at: '2026-11-15T20:00:00.000Z', title: 'T', status: 'ready' }],
};

describe('publish_existing schema', () => {
  it('requires the media reference for the kind and rejects the others', () => {
    expect(PublishExistingSchema.safeParse(SCHEDULED_TASK).success).toBe(true);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, taskId: undefined }).success).toBe(false);
    expect(
      PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mediaKind: 'upload', taskId: undefined }).success,
    ).toBe(false);
    expect(
      PublishExistingSchema.safeParse({
        ...SCHEDULED_TASK,
        mediaKind: 'upload',
        taskId: undefined,
        uploadId: '123e4567-e89b-12d3-a456-426614174000',
      }).success,
    ).toBe(true);
    expect(
      PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mediaKind: 'upload', taskId: undefined, uploadId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined }).success,
    ).toBe(false);
    expect(
      PublishExistingSchema.safeParse({
        ...SCHEDULED_TASK,
        mediaKind: 'image',
        taskId: undefined,
        imageData: TINY_PNG_BASE64,
        imageContentType: 'image/png',
      }).success,
    ).toBe(true);
  });

  it('restricts images to instagram and enforces the mode/schedule rules', () => {
    expect(
      PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined, imageData: TINY_PNG_BASE64, imageContentType: 'image/png', provider: 'youtube' }).success,
    ).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, startAt: undefined }).success).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mode: 'asap', startAt: undefined, times: undefined }).success).toBe(true);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, mode: 'asap' }).success).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, title: '' }).success).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...SCHEDULED_TASK, videoPath: '/tmp/v.mp4' }).success).toBe(false);
  });
});

describe('publish_existing client call', () => {
  it('schedules a task by id and narrows the slot reply', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => SCHEDULED_REPLY);
    const result = await publishExisting(fakeClient(request), SCHEDULED_TASK);
    expect(result.mode).toBe('scheduled');
    if (result.mode !== 'scheduled') return;
    expect(result.scheduleId).toBe('sched-1');
    expect(result.slots[0]).toMatchObject({ id: 'slot-1', status: 'ready' });
    const [path, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    expect(path).toBe('/api/media/publish-existing');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      media: { kind: 'task', taskId: 'task-1' },
      title: 'T',
      description: 'D',
      publishing: {
        mode: 'scheduled',
        providers: ['instagram'],
        accounts: { instagram: ['ig-1'] },
        schedule: { startAt: '2026-11-15T20:00:00', times: ['20:00'], timezone: 'UTC' },
      },
      caption: 'D',
    });
    expect(body).not.toHaveProperty('videoPath');
  });

  it('publishes an upload ASAP and narrows per-account results', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      mode: 'asap',
      mediaKind: 'upload',
      publishes: [{ provider: 'instagram', success: true, results: [{ accountId: 'ig-1', success: true, postId: 'p1' }] }],
      logId: 'log-1',
    }));
    const result = await publishExisting(fakeClient(request), {
      mediaKind: 'upload',
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'instagram',
      accountIds: ['ig-1'],
      title: 'T',
      description: 'D',
      mode: 'asap',
      caption: 'D',
    });
    expect(result.mode).toBe('asap');
    if (result.mode !== 'asap') return;
    expect(result.success).toBe(true);
    expect(result.publishes[0]?.results[0]).toMatchObject({ accountId: 'ig-1', success: true, postId: 'p1' });
    const [, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      media: { kind: 'upload', uploadId: '123e4567-e89b-12d3-a456-426614174000' },
      publishing: { mode: 'asap', providers: ['instagram'] },
    });
    expect(body.publishing).not.toHaveProperty('schedule');
  });

  it('sends an inline image with its declared type', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      mode: 'asap',
      mediaKind: 'image',
      publishes: [{ provider: 'instagram', success: true, results: [{ accountId: 'ig-1', success: true }] }],
      logId: 'log-1',
    }));
    await publishExisting(fakeClient(request), {
      mediaKind: 'image',
      imageData: TINY_PNG_BASE64,
      imageContentType: 'image/png',
      provider: 'instagram',
      accountIds: ['ig-1'],
      title: 'T',
      description: 'D',
      mode: 'asap',
      caption: 'D',
    });
    const [, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({ media: { kind: 'image', imageData: TINY_PNG_BASE64, contentType: 'image/png' } });
  });

  it('fails fast before any fetch: missing reference, image provider, bad image, bad schedule', async () => {
    const request = vi.fn(async () => ({}));
    const client = fakeClient(request);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, taskId: '   ' }),
    ).rejects.toThrow(/taskId is required/);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined, imageData: TINY_PNG_BASE64, imageContentType: 'image/png', provider: 'youtube' }),
    ).rejects.toThrow(/instagram/);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined, imageData: 'not-base64!', imageContentType: 'image/png', mode: 'asap', startAt: undefined, times: undefined }),
    ).rejects.toThrow(/base64/);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined, imageData: Buffer.alloc(9 * 1024 * 1024).toString('base64'), imageContentType: 'image/png', mode: 'asap', startAt: undefined, times: undefined }),
    ).rejects.toThrow(/too large/);
    await expect(publishExisting(client, { ...SCHEDULED_TASK, startAt: undefined })).rejects.toThrow(/startAt and times are required/);
    await expect(publishExisting(client, { ...SCHEDULED_TASK, mode: 'asap' })).rejects.toThrow(/must not be set/);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, provider: 'tiktok' as 'instagram' }),
    ).rejects.toThrow(/provider must be one of/);
    await expect(publishExisting(client, { ...SCHEDULED_TASK, accountIds: [] })).rejects.toThrow(
      /At least one account ID is required/,
    );
    await expect(publishExisting(client, { ...SCHEDULED_TASK, title: '   ' })).rejects.toThrow(
      /title is required/,
    );
    await expect(publishExisting(client, { ...SCHEDULED_TASK, description: '' })).rejects.toThrow(
      /description is required/,
    );
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, mediaKind: 'upload', taskId: undefined }),
    ).rejects.toThrow(/uploadId is required/);
    await expect(
      publishExisting(client, { ...SCHEDULED_TASK, mediaKind: 'image', taskId: undefined }),
    ).rejects.toThrow(/imageData and imageContentType are required/);
    // 'AB==' is valid base64 alphabet with a valid length, but the
    // round-trip re-encodes to 'AA==', so it is not real base64 bytes.
    await expect(
      publishExisting(client, {
        ...SCHEDULED_TASK,
        mediaKind: 'image',
        taskId: undefined,
        imageData: 'AB==',
        imageContentType: 'image/png',
        mode: 'asap',
        startAt: undefined,
        times: undefined,
      }),
    ).rejects.toThrow(/base64/);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a malformed body instead of reporting success', async () => {
    const request = vi.fn(async (): Promise<unknown> => ({ success: true }));
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
    request.mockResolvedValueOnce({ success: true, mode: 'scheduled', schedule: { id: 'sched-1' }, slots: [{ id: 'slot-1' }] });
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
  });

  it('rejects malformed asap bodies and slot entries', async () => {
    const request = vi.fn(async (): Promise<unknown> => ({
      success: true,
      mode: 'asap',
      mediaKind: 'video',
      publishes: [],
      logId: 'x',
    }));
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
    request.mockResolvedValueOnce({
      success: true,
      mode: 'asap',
      mediaKind: 'upload',
      publishes: [{ provider: 'instagram' }],
      logId: 'x',
    });
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
    request.mockResolvedValueOnce({
      success: true,
      mode: 'scheduled',
      schedule: { id: 'sched-1' },
      slots: ['not-an-object'],
    });
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
    request.mockResolvedValueOnce({
      success: true,
      mode: 'scheduled',
      schedule: { id: 'sched-1' },
      slots: [{ id: 'slot-1', slot_at: '2026-11-15T20:00:00.000Z', title: 42 }],
    });
    await expect(publishExisting(fakeClient(request), SCHEDULED_TASK)).rejects.toThrow(/Malformed publish-existing/);
  });

  it('defaults a slot status to ready and omits unset optional fields', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => ({
      success: true,
      mode: 'scheduled',
      replayed: false,
      schedule: { id: 'sched-1' },
      slots: [{ id: 'slot-1', slot_at: '2026-11-15T20:00:00.000Z', title: 'T' }],
    }));
    const result = await publishExisting(fakeClient(request), {
      ...SCHEDULED_TASK,
      caption: undefined,
      mode: undefined,
      timezone: undefined,
    });
    expect(result.mode).toBe('scheduled');
    if (result.mode !== 'scheduled') return;
    expect(result.slots[0]?.status).toBe('ready');
    const [, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('caption');
    expect(body).not.toHaveProperty('personaId');
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('privacyStatus');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body.publishing).not.toHaveProperty('pinterestBoardId');
  });

  it('keeps a dead-account warning and drops a malformed one', async () => {
    const warning = { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] };
    const request = vi.fn(async () => ({
      ...SCHEDULED_REPLY,
      warnings: [warning, { code: 'account_needs_reconnect', accounts: [{ provider: 'not-a-provider', accountId: 'x' }] }, 'invalid_credentials'],
    }));
    const result = await publishExisting(fakeClient(request), SCHEDULED_TASK);
    expect(result.mode).toBe('scheduled');
    if (result.mode !== 'scheduled') return;
    expect(result.warnings).toEqual([warning]);
    expect(JSON.stringify(result)).not.toContain('invalid_credentials');
  });

  it('schedules when the warning list is malformed', async () => {
    const request = vi.fn(async () => ({ ...SCHEDULED_REPLY, warnings: 'invalid_credentials' }));
    const result = await publishExisting(fakeClient(request), SCHEDULED_TASK);
    expect(result.mode).toBe('scheduled');
    if (result.mode !== 'scheduled') return;
    expect(result.warnings).toBeUndefined();
  });

  it('defaults mode to scheduled with UTC timezone and passes optional fields through', async () => {
    const request = vi.fn(async (_path: string, _init?: unknown) => SCHEDULED_REPLY);
    await publishExisting(fakeClient(request), {
      ...SCHEDULED_TASK,
      mode: undefined,
      timezone: undefined,
      personaId: 'persona-1',
      tags: ['t1'],
      privacyStatus: 'public',
      caption: 'C',
      idempotencyKey: 'key-1',
      boardId: 'board-1',
    });
    const [, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      personaId: 'persona-1',
      tags: ['t1'],
      privacyStatus: 'public',
      caption: 'C',
      idempotencyKey: 'key-1',
      publishing: { mode: 'scheduled', schedule: { timezone: 'UTC' }, pinterestBoardId: 'board-1' },
    });
  });
});

describe('publish_existing tool handler', () => {
  it('summarizes a scheduled slot as human text + machine JSON', async () => {
    const request = vi.fn(async () => SCHEDULED_REPLY);
    const response = await handlePublishExisting(fakeClient(request), SCHEDULED_TASK);
    expect(response.isError).toBeUndefined();
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('Scheduled existing task to instagram');
    expect(block.text).toContain('Schedule sched-1');
    expect(block.text).toContain('slot slot-1 at 2026-11-15T20:00:00.000Z (ready)');
    expect(block.text).toContain('"scheduleId":"sched-1"');
    expect(block.text).not.toContain('account_needs_reconnect');
  });

  it('names account_needs_reconnect in the tool text without a provider error', async () => {
    const request = vi.fn(async () => ({
      ...SCHEDULED_REPLY,
      warnings: [{ code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] }],
    }));
    const response = await handlePublishExisting(fakeClient(request), SCHEDULED_TASK);
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('Warning account_needs_reconnect: reconnect youtube UC1');
    expect(block.text).toContain('"code":"account_needs_reconnect"');
    expect(block.text).not.toMatch(/invalid_credentials|OAuthException|Unauthorized/);
  });

  it('summarizes an ASAP publish per provider and account', async () => {
    const request = vi.fn(async () => ({
      success: true,
      mode: 'asap',
      mediaKind: 'upload',
      publishes: [
        { provider: 'instagram', success: true, results: [{ accountId: 'ig-1', success: true, permalink: 'https://instagram.test/p/1' }] },
      ],
      logId: 'log-1',
    }));
    const response = await handlePublishExisting(fakeClient(request), {
      ...SCHEDULED_TASK,
      mediaKind: 'upload',
      taskId: undefined,
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      mode: 'asap',
      startAt: undefined,
      times: undefined,
    });
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('Published existing upload');
    expect(block.text).toContain('instagram: published');
    expect(block.text).toContain('published (https://instagram.test/p/1)');
  });

  it('returns the machine code for an ApiError', async () => {
    const coded = vi.fn(async () => {
      throw new ApiError('unknown task', 'TASK_NOT_FOUND', 'media.taskId', 404);
    });
    const response = await handlePublishExisting(fakeClient(coded), SCHEDULED_TASK);
    expect(response.isError).toBe(true);
    const text = response.content[0];
    expect(text?.type === 'text' && text.text).toContain('"code":"TASK_NOT_FOUND"');
    expect(text?.type === 'text' && text.text).toContain('"field":"media.taskId"');
  });

  it('notes a replayed schedule', async () => {
    const request = vi.fn(async () => ({ ...SCHEDULED_REPLY, replayed: true }));
    const response = await handlePublishExisting(fakeClient(request), SCHEDULED_TASK);
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('(replayed: the same request was already scheduled)');
  });

  it('summarizes mixed asap results with links and failures', async () => {
    const request = vi.fn(async () => ({
      success: false,
      mode: 'asap',
      mediaKind: 'upload',
      publishes: [
        {
          provider: 'instagram',
          success: false,
          results: [
            { accountId: 'ig-1', success: true, videoUrl: 'https://instagram.test/v/1' },
            { accountId: 'ig-2', success: true, postId: 'p2' },
            { accountId: 'ig-3', success: true },
            { accountId: 'ig-4', success: false, error: 'revoked token' },
            { accountId: 'ig-5', success: false },
          ],
        },
      ],
      logId: 'log-1',
    }));
    const response = await handlePublishExisting(fakeClient(request), {
      ...SCHEDULED_TASK,
      mediaKind: 'upload',
      taskId: undefined,
      uploadId: '123e4567-e89b-12d3-a456-426614174000',
      mode: 'asap',
      startAt: undefined,
      times: undefined,
    });
    const block = response.content[0];
    expect(block?.type).toBe('text');
    if (block?.type !== 'text') return;
    expect(block.text).toContain('instagram: FAILED');
    expect(block.text).toContain('some providers failed');
    expect(block.text).toContain('- ig-1: published (https://instagram.test/v/1)');
    expect(block.text).toContain('- ig-2: published (p2)');
    expect(block.text).toContain('- ig-3: published\n');
    expect(block.text).toContain('- ig-4: FAILED — revoked token');
    expect(block.text).toContain('- ig-5: FAILED — unknown error');
  });

  it('returns a plain error for a non-ApiError and for an ApiError without a code', async () => {
    const boom = vi.fn(async () => {
      throw new Error('boom');
    });
    const plain = await handlePublishExisting(fakeClient(boom), SCHEDULED_TASK);
    expect(plain.isError).toBe(true);
    const plainText = plain.content[0];
    expect(plainText?.type === 'text' && plainText.text).toContain('Error publishing existing media: boom');
    expect(plainText?.type === 'text' && plainText.text).not.toContain('"code"');
    const codeless = vi.fn(async () => {
      throw new ApiError('no code', null, null, 500);
    });
    const codelessResponse = await handlePublishExisting(fakeClient(codeless), SCHEDULED_TASK);
    expect(codelessResponse.isError).toBe(true);
    const codelessText = codelessResponse.content[0];
    expect(codelessText?.type === 'text' && codelessText.text).toContain('Error publishing existing media: no code');
    expect(codelessText?.type === 'text' && codelessText.text).not.toContain('"code"');
  });
});

describe('publish_existing tool on both transports', () => {
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

  it('offers publish_existing on http (JSON only, no local file) and stdio', async () => {
    for (const transport of ['http', 'stdio'] as const) {
      const publish = (await listTools(transport)).find((t) => t.name === 'publish_video');
      expect((publish?.inputSchema.properties as { action: { enum: string[] } }).action.enum).toContain('publish_existing');
      expect(publish?.inputSchema.properties).toHaveProperty('mediaKind');
      expect(publish?.inputSchema.properties).toHaveProperty('taskId');
    }
    const httpPublish = (await listTools('http')).find((t) => t.name === 'publish_video');
    expect((httpPublish?.inputSchema.properties as { action: { enum: string[] } }).action.enum).toEqual([
      'create_upload',
      'complete_upload',
      'publish_upload',
      'publish_existing',
    ]);
  });

  it('invokes publish_existing through the server', async () => {
    const request = vi.fn(async () => SCHEDULED_REPLY);
    const server = createPostEngineerMcpServer(fakeClient(request), 'http');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const called = await client.callTool({ name: 'publish_video', arguments: { action: 'publish_existing', ...SCHEDULED_TASK } });
      expect(called.isError).toBeFalsy();
      expect((request.mock.calls[0] as unknown as [string])[0]).toBe('/api/media/publish-existing');
    } finally {
      await client.close();
    }
  });
});
