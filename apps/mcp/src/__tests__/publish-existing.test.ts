import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { PostEngineerClient } from '../client.js';
import type { PublishExistingInput } from '../client-types.js';
import { publishExisting } from '../client-publish-existing.js';
import { ApiError } from '../errors.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PublishExistingSchema, type PublishExistingArgs } from '../publish-existing-shape.js';
import { handlePublishExisting } from '../tools-publish-existing.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) =>
    handler(args),
}));

const ACCOUNTS_LISTING = {
  authenticated: true,
  accounts: [
    { provider: 'youtube', recordId: 'rec-1', channelId: 'UC1', channelName: 'Maria Cooks' },
    { provider: 'instagram', recordId: 'rec-2', igUserId: 'ig-1', username: 'maria.cooks' },
    { provider: 'instagram', recordId: 'rec-3', igUserId: 'ig-2', username: 'maria.travels' },
  ],
};

const PERSONA_ID = '33333333-3333-4333-8333-333333333333';

const SCHEDULED_REPLY = {
  success: true,
  mode: 'scheduled',
  replayed: false,
  schedule: { id: 'sched-1' },
  slots: [{ id: 'slot-1', slot_at: '2026-12-01T20:00:00.000Z', title: 'T', status: 'ready' }],
};

const ASAP_REPLY = {
  success: true,
  mode: 'asap',
  replayed: false,
  mediaKind: 'upload',
  publishes: [
    { provider: 'youtube', success: true, results: [{ accountId: 'UC1', success: true, videoUrl: 'https://youtu.be/v1' }] },
    { provider: 'instagram', success: true, results: [{ accountId: 'ig-1', success: true, permalink: 'https://instagram.com/p/1' }] },
  ],
  logId: 'log-1',
};

/** A client whose request answers per path; the publish reply is configurable. */
function fakeClient(publishReply: () => Promise<unknown>, bound: Record<string, string[]> = {}) {
  const request = vi.fn(async (path: string, _init?: unknown): Promise<unknown> => {
    if (path.startsWith('/api/persona/publishing-accounts')) {
      const defaults = { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], ...bound };
      return { success: true, defaults };
    }
    if (path === '/api/media/publish-existing') return publishReply();
    throw new Error(`unexpected request ${path}`);
  });
  const client = {
    request,
    getHeaders: (includeContentType = true) => (includeContentType ? { 'Content-Type': 'application/json' } : {}),
    listSocialAccounts: vi.fn(async () => ACCOUNTS_LISTING),
    listPersonas: vi.fn(async () => ({ personas: [] })),
  } as unknown as PostEngineerClient;
  return { client, request };
}

function publishBody(request: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = request.mock.calls.find(([path]) => path === '/api/media/publish-existing') as [string, { body: string }] | undefined;
  if (call === undefined) throw new Error('publish-existing was never called');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

function textOf(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content[0];
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function args(overrides: Partial<PublishExistingArgs> = {}): PublishExistingArgs {
  return {
    mediaKind: 'task',
    taskId: 'task-1',
    accounts: ['UC1'],
    title: 'T',
    description: 'D',
    mode: 'scheduled',
    publishAt: '2026-12-01T20:00:00',
    timezone: 'UTC',
    ...overrides,
  };
}

describe('publish_existing schema', () => {
  it('requires the media reference for the kind', () => {
    expect(PublishExistingSchema.safeParse(args()).success).toBe(true);
    expect(PublishExistingSchema.safeParse(args({ taskId: undefined })).success).toBe(false);
    expect(PublishExistingSchema.safeParse(args({ mediaKind: 'upload', taskId: undefined })).success).toBe(false);
    expect(
      PublishExistingSchema.safeParse(args({ mediaKind: 'upload', taskId: undefined, uploadId: '123e4567-e89b-12d3-a456-426614174000' })).success,
    ).toBe(true);
    expect(PublishExistingSchema.safeParse(args({ mediaKind: 'upload', taskId: undefined, uploadId: 'not-a-uuid' })).success).toBe(false);
  });

  it('takes an image only from imagePath: base64 bytes are never a tool argument', () => {
    const image = { mediaKind: 'image' as const, taskId: undefined };
    const missing = PublishExistingSchema.safeParse(args(image));
    expect(missing.success).toBe(false);
    expect(JSON.stringify(missing.error?.issues)).toContain('create_upload');
    expect(PublishExistingSchema.safeParse(args({ ...image, imagePath: '/tmp/a.png' })).success).toBe(true);
    expect(PublishExistingSchema.safeParse({ ...args({ ...image, imagePath: '/tmp/a.png' }), imageData: 'iVBORw0KGgo=' }).success).toBe(false);
  });

  it('requires mode, and publishAt exactly when scheduled', () => {
    const { mode: _mode, ...noMode } = args();
    expect(PublishExistingSchema.safeParse(noMode).success).toBe(false);
    expect(PublishExistingSchema.safeParse(args({ publishAt: undefined })).success).toBe(false);
    expect(PublishExistingSchema.safeParse(args({ mode: 'asap' })).success).toBe(false);
    expect(PublishExistingSchema.safeParse(args({ mode: 'asap', publishAt: undefined })).success).toBe(true);
    expect(PublishExistingSchema.safeParse(args({ publishAt: 'next friday' })).success).toBe(false);
  });

  it('rejects the old single-provider and start + times fields', () => {
    expect(PublishExistingSchema.safeParse({ ...args(), provider: 'youtube' }).success).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...args(), accountIds: ['UC1'] }).success).toBe(false);
    expect(PublishExistingSchema.safeParse({ ...args(), startAt: '2026-12-01T20:00:00', times: ['20:00'] }).success).toBe(false);
  });
});

describe('publish_existing client call', () => {
  const BASE: PublishExistingInput = {
    media: { kind: 'task', taskId: 'task-1' },
    accounts: { youtube: ['UC1'], instagram: ['ig-1'] },
    title: 'T',
    description: 'D',
    mode: 'scheduled',
    publishAt: '2026-12-01T20:00:00',
    timezone: 'UTC',
    idempotencyKey: 'key-1',
  };

  it('sends every network of the accounts in one publishing block', async () => {
    const { client, request } = fakeClient(async () => SCHEDULED_REPLY);
    await publishExisting(client, { ...BASE, boardId: 'board-1', personaId: PERSONA_ID, tags: ['t'], privacyStatus: 'public', caption: 'C' });
    expect(publishBody(request)).toEqual({
      media: { kind: 'task', taskId: 'task-1' },
      title: 'T',
      description: 'D',
      idempotencyKey: 'key-1',
      personaId: PERSONA_ID,
      tags: ['t'],
      privacyStatus: 'public',
      caption: 'C',
      publishing: {
        mode: 'scheduled',
        providers: ['youtube', 'instagram'],
        accounts: { youtube: ['UC1'], instagram: ['ig-1'] },
        schedule: { publishAt: '2026-12-01T20:00:00', timezone: 'UTC' },
        pinterestBoardId: 'board-1',
      },
    });
  });

  it('sends no schedule for asap and omits unset optional fields', async () => {
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    await publishExisting(client, { ...BASE, mode: 'asap', publishAt: undefined });
    const body = publishBody(request);
    expect(body.publishing).not.toHaveProperty('schedule');
    expect(body.publishing).not.toHaveProperty('pinterestBoardId');
    for (const field of ['personaId', 'tags', 'privacyStatus', 'caption']) expect(body).not.toHaveProperty(field);
  });

  it('narrows an asap reply, replayed flag included', async () => {
    const { client } = fakeClient(async () => ({ ...ASAP_REPLY, replayed: true }));
    const result = await publishExisting(client, { ...BASE, mode: 'asap', publishAt: undefined });
    expect(result).toMatchObject({ mode: 'asap', success: true, replayed: true, mediaKind: 'upload', logId: 'log-1' });
  });

  it('defaults a slot status to ready', async () => {
    const { client } = fakeClient(async () => ({ ...SCHEDULED_REPLY, slots: [{ id: 'slot-1', slot_at: '2026-12-01T20:00:00.000Z', title: 'T' }] }));
    const result = await publishExisting(client, BASE);
    expect(result.mode === 'scheduled' && result.slots[0]?.status).toBe('ready');
  });

  it.each([
    ['no mode', { success: true }],
    ['a slot without its fields', { ...SCHEDULED_REPLY, slots: [{ id: 'slot-1' }] }],
    ['a slot that is not an object', { ...SCHEDULED_REPLY, slots: ['slot-1'] }],
    ['an unknown media kind', { ...ASAP_REPLY, mediaKind: 'video' }],
    ['a publish without results', { ...ASAP_REPLY, publishes: [{ provider: 'instagram' }] }],
  ])('rejects a malformed body (%s) instead of reporting success', async (_label, reply) => {
    const { client } = fakeClient(async () => reply);
    await expect(publishExisting(client, BASE)).rejects.toThrow(/Malformed publish-existing/);
  });
});

describe('publish_existing tool handler', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'publish-existing-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves account names across networks into one call and echoes them', async () => {
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    const response = await handlePublishExisting(
      client,
      args({ mediaKind: 'upload', taskId: undefined, uploadId: '123e4567-e89b-12d3-a456-426614174000', accounts: ['Maria Cooks', 'maria.cooks'], mode: 'asap', publishAt: undefined, tags: ['t'], privacyStatus: 'public' }),
    );
    expect(response.isError).toBeUndefined();
    const body = publishBody(request);
    expect(body.publishing).toMatchObject({ mode: 'asap', providers: ['youtube', 'instagram'], accounts: { youtube: ['UC1'], instagram: ['ig-1'] } });
    const text = textOf(response);
    expect(text).toContain('Resolved: account "Maria Cooks" → youtube UC1; account "maria.cooks" → instagram ig-1.');
    expect(text).toContain('youtube: published\n- UC1: published (https://youtu.be/v1)');
    expect(text).toContain('(all networks succeeded)');
  });

  it('stops before publishing when an account reference matches nothing', async () => {
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    const response = await handlePublishExisting(client, args({ accounts: ['nobody'] }));
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('No account matches "nobody"');
    expect(request).not.toHaveBeenCalled();
  });

  it("publishes to the persona's bound accounts when no accounts are given", async () => {
    const { client, request } = fakeClient(async () => SCHEDULED_REPLY, { youtube: ['UC1'], instagram: ['ig-2'] });
    const response = await handlePublishExisting(client, args({ accounts: undefined, personaId: PERSONA_ID }));
    expect(response.isError).toBeUndefined();
    const body = publishBody(request);
    expect(body).toMatchObject({ personaId: PERSONA_ID, publishing: { providers: ['youtube', 'instagram'], accounts: { youtube: ['UC1'], instagram: ['ig-2'] } } });
    expect(textOf(response)).toContain("Resolved: the persona's bound accounts: youtube (UC1); instagram (ig-2).");
  });

  it('asks where to publish with neither accounts nor a persona, or a persona with none bound', async () => {
    const none = fakeClient(async () => SCHEDULED_REPLY);
    const noTarget = await handlePublishExisting(none.client, args({ accounts: undefined }));
    expect(textOf(noTarget)).toContain('say where to publish');
    const unbound = await handlePublishExisting(none.client, args({ accounts: undefined, personaId: PERSONA_ID }));
    expect(textOf(unbound)).toContain('the persona has no bound publishing accounts');
    expect(none.request.mock.calls.some(([path]) => path === '/api/media/publish-existing')).toBe(false);
  });

  it('rejects an image bound for a video-only network before reading it', async () => {
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    const response = await handlePublishExisting(client, args({ mediaKind: 'image', taskId: undefined, imagePath: join(dir, 'missing.png'), accounts: ['UC1', 'ig-1'] }));
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('images go to instagram, bluesky, linkedin, threads, facebook, pinterest only; drop the youtube account(s).');
    expect(request.mock.calls.some(([path]) => path === '/api/media/publish-existing')).toBe(false);
  });

  it('reads a local PNG and sends it as base64 with its real type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const path = join(dir, 'photo.png');
    await writeFile(path, png);
    const { client, request } = fakeClient(async () => ({ ...ASAP_REPLY, mediaKind: 'image', publishes: [ASAP_REPLY.publishes[1]] }));
    const response = await handlePublishExisting(client, args({ mediaKind: 'image', taskId: undefined, imagePath: path, accounts: ['ig-1'], mode: 'asap', publishAt: undefined }));
    expect(response.isError).toBeUndefined();
    expect(publishBody(request).media).toEqual({ kind: 'image', imageData: png.toString('base64'), contentType: 'image/png' });
    // The local path never reaches the output.
    expect(textOf(response)).not.toContain(dir);
  });

  it('refuses a local WebP: Instagram image posts take JPEG or PNG', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(4)]);
    const path = join(dir, 'photo.webp');
    await writeFile(path, webp);
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    const response = await handlePublishExisting(client, args({ mediaKind: 'image', taskId: undefined, imagePath: path, accounts: ['ig-1'] }));
    expect(textOf(response)).toContain('JPEG or PNG');
    expect(request).not.toHaveBeenCalled();
  });

  it('passes the caller key through, and generates one per call when omitted', async () => {
    const { client, request } = fakeClient(async () => SCHEDULED_REPLY);
    await handlePublishExisting(client, args({ idempotencyKey: 'my-key' }));
    expect(publishBody(request).idempotencyKey).toBe('my-key');
    request.mockClear();
    await handlePublishExisting(client, args());
    expect(publishBody(request).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('summarizes a schedule, and notes a replay', async () => {
    const { client } = fakeClient(async () => SCHEDULED_REPLY);
    const text = textOf(await handlePublishExisting(client, args()));
    expect(text).toContain('Scheduled existing task.\nSchedule sched-1.\n- slot slot-1 at 2026-12-01T20:00:00.000Z (ready)');
    expect(text).toContain('"scheduleId":"sched-1"');
    const replay = fakeClient(async () => ({ ...SCHEDULED_REPLY, replayed: true }));
    expect(textOf(await handlePublishExisting(replay.client, args()))).toContain('(replayed: the same request was already scheduled)');
  });

  it('summarizes an asap replay and mixed per-account outcomes', async () => {
    const replay = fakeClient(async () => ({ ...ASAP_REPLY, replayed: true }));
    const replayed = textOf(await handlePublishExisting(replay.client, args({ mode: 'asap', publishAt: undefined })));
    expect(replayed).toContain('(replayed from the first call: nothing was posted again)');
    const mixed = fakeClient(async () => ({
      ...ASAP_REPLY,
      success: false,
      publishes: [
        {
          provider: 'instagram',
          success: false,
          results: [
            { accountId: 'ig-1', success: true },
            { accountId: 'ig-2', success: false, error: 'revoked token' },
            { accountId: 'ig-3', success: false },
          ],
        },
      ],
    }));
    const text = textOf(await handlePublishExisting(mixed.client, args({ mode: 'asap', publishAt: undefined })));
    expect(text).toContain('(some networks failed)');
    expect(text).toContain('instagram: FAILED\n- ig-1: published\n- ig-2: FAILED — revoked token\n- ig-3: FAILED — unknown error');
  });

  it('returns the machine code for an ApiError and plain text otherwise', async () => {
    const coded = fakeClient(async () => {
      throw new ApiError('This video upload is already scheduled.', 'VIDEO_UPLOAD_SCHEDULED', 'media.uploadId', 409);
    });
    const codedResponse = await handlePublishExisting(coded.client, args());
    expect(codedResponse.isError).toBe(true);
    expect(textOf(codedResponse)).toContain('"code":"VIDEO_UPLOAD_SCHEDULED"');
    const plain = fakeClient(async () => {
      throw new Error('boom');
    });
    const plainText = textOf(await handlePublishExisting(plain.client, args()));
    expect(plainText).toBe('Error publishing existing media: boom');
  });

  it('reports schema problems by field without calling the API', async () => {
    const { client, request } = fakeClient(async () => SCHEDULED_REPLY);
    const response = await handlePublishExisting(client, args({ publishAt: undefined }));
    expect(textOf(response)).toBe('Error publishing existing media: publishAt: publishAt is required when mode is scheduled.');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('publish_existing tool on both transports', () => {
  async function connect(client: PostEngineerClient, transport: 'stdio' | 'http'): Promise<Client> {
    const server = createPostEngineerMcpServer(client, transport);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
    return mcp;
  }

  async function publishProperties(transport: 'stdio' | 'http'): Promise<Record<string, unknown>> {
    const mcp = await connect({} as unknown as PostEngineerClient, transport);
    try {
      const { tools } = await mcp.listTools();
      return (tools.find((tool) => tool.name === 'publish_video')?.inputSchema.properties ?? {}) as Record<string, unknown>;
    } finally {
      await mcp.close();
    }
  }

  it('offers a local image path on stdio, no image bytes anywhere, and no single-provider fields', async () => {
    const stdio = await publishProperties('stdio');
    const http = await publishProperties('http');
    expect(stdio).toHaveProperty('imagePath');
    expect(http).not.toHaveProperty('imagePath');
    for (const properties of [stdio, http]) expect(properties).not.toHaveProperty('imageData');
    for (const properties of [stdio, http]) {
      expect(properties).toHaveProperty('publishAt');
      expect(properties).not.toHaveProperty('startAt');
      expect(properties).not.toHaveProperty('times');
    }
  });

  it('describes the remote mediaKind with the signed upload, not a local path', async () => {
    const descriptionOf = (properties: Record<string, unknown>): string =>
      (properties.mediaKind as { description?: string } | undefined)?.description ?? '';
    const stdio = descriptionOf(await publishProperties('stdio'));
    const http = descriptionOf(await publishProperties('http'));
    // The stdio shape reads the image from disk, so its description names the field.
    expect(stdio).toContain('imagePath');
    // The remote shape has no imagePath: advertising it sends an agent at a
    // field the transport never accepts, so the description names the upload path.
    expect(http).not.toContain('imagePath');
    expect(http).toContain('create_upload');
    expect(http).toContain('mediaKind upload');
  });

  it('rejects a local image path on the http server', async () => {
    const { client, request } = fakeClient(async () => ASAP_REPLY);
    const mcp = await connect(client, 'http');
    try {
      const called = await mcp.callTool({
        name: 'publish_video',
        arguments: { action: 'publish_existing', ...args({ mediaKind: 'image', taskId: undefined, imagePath: '/etc/hosts', accounts: ['ig-1'] }) },
      });
      expect(called.isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    } finally {
      await mcp.close();
    }
  });

  it('invokes publish_existing through the server', async () => {
    const { client, request } = fakeClient(async () => SCHEDULED_REPLY);
    const mcp = await connect(client, 'http');
    try {
      const called = await mcp.callTool({ name: 'publish_video', arguments: { action: 'publish_existing', ...args() } });
      expect(called.isError).toBeFalsy();
      expect(publishBody(request).publishing).toMatchObject({ providers: ['youtube'] });
    } finally {
      await mcp.close();
    }
  });
});
