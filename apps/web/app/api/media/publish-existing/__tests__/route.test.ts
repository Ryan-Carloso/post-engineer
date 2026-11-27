// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/trial', () => ({ assertTrialActive: vi.fn(async () => null) }));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer secret', 'x-user-id': 'user-uuid-1' })),
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { publishExisting: {} },
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    generateLogId: vi.fn(() => 'log-1'),
    logUploadStart: vi.fn(),
    logUploadSuccess: vi.fn(),
    logUploadError: vi.fn(),
  },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/videos/signed-upload', () => {
  class VideoUploadError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = 'VideoUploadError';
    }
  }
  return {
    VideoUploadError,
    assertUploadFitsProviders: vi.fn(),
    claimUploadForPublish: vi.fn(),
    createSupabaseVideoUploadStore: vi.fn(),
    createSupabaseVideoUploadStorage: vi.fn(),
  };
});
vi.mock('@/lib/videos/publish-uploaded', () => ({
  dispatchPublish: vi.fn(async (provider: string, _form: FormData, _userId: string, _logId: string, _startTime: number) => ({
    success: true,
    provider,
    results: [{ accountId: 'acc-1', success: true, videoId: 'vid-1' }],
    logId: 'log-1',
  })),
}));
vi.mock('@/lib/upload/handlers', () => ({
  buildUploadErrorResponse: vi.fn(
    (error: unknown) =>
      NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'failed' }, { status: 500 }),
  ),
}));

import { POST } from '../route';
import { logger } from '@/lib/logger';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  VideoUploadError,
  assertUploadFitsProviders,
  claimUploadForPublish,
  createSupabaseVideoUploadStore,
  createSupabaseVideoUploadStorage,
  type VideoUploadContentType,
  type VideoUploadRow,
} from '@/lib/videos/signed-upload';
import { dispatchPublish } from '@/lib/videos/publish-uploaded';
import type { SocialProvider } from '@/lib/providers/registry';
import { deterministicUuid } from '@/lib/idempotency';
import { assertTrialActive } from '@/lib/trial';

const USER_ID = 'user-uuid-1';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const PERSONA_ID = '33333333-3333-4333-8333-333333333333';

function jsonRequest(body: unknown): Request {
  return new Request('https://post-engineer.com/api/media/publish-existing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function futurePublishAt(hoursAhead: number): string {
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  return at.toISOString();
}

interface FakeConfig {
  personaRow?: Record<string, unknown> | null;
  personaReads?: { data: unknown; error: unknown }[];
  socialRows?: Record<string, unknown>[];
  boundRows?: Record<string, unknown>[];
  existingSchedule?: Record<string, unknown> | null;
  existingSlots?: Record<string, unknown>[];
  scheduleInsertError?: unknown;
  storageRemoveError?: unknown;
  raceWinner?: boolean;
  slotInsertError?: unknown;
  slotInsertRows?: Record<string, unknown>[];
  storageUpload?: { data: { path: string } | null; error: { message: string } | null };
  uploadRow?: Record<string, unknown> | null;
  liveUploadSlots?: Record<string, unknown>[];
  liveUploadSlotsError?: unknown;
  ledgerClaims?: Record<string, Record<string, unknown>>;
  ledgerClaimError?: unknown;
}

function fakeSupabase(config: FakeConfig = {}) {
  const insertedSchedules: Record<string, unknown>[] = [];
  const insertedSlots: Record<string, unknown>[] = [];
  const updatedUploads: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const removedPaths: string[] = [];
  const uploadedPaths: string[] = [];
  let scheduleInsertAttempts = 0;
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === 'claim_publish_ledger') {
      if (config.ledgerClaimError !== undefined) return { data: null, error: config.ledgerClaimError };
      const accountId = String(args.p_account_id);
      return { data: config.ledgerClaims?.[accountId] ?? { outcome: 'claimed' }, error: null };
    }
    return { data: true, error: null };
  });
  const storageUpload = vi.fn(async (path: string) => {
    uploadedPaths.push(path);
    return config.storageUpload ?? { data: { path }, error: null };
  });
  const storageRemove = vi.fn(async (paths: string[]) => {
    removedPaths.push(...paths);
    if (config.storageRemoveError !== undefined) throw config.storageRemoveError;
    return { error: null };
  });

  class Query {
    private table: string;
    private op: 'select' | 'insert' | 'delete' | 'update' = 'select';
    private values: unknown = null;
    private liveUploadRead = false;

    constructor(table: string) {
      this.table = table;
    }

    select(): this {
      return this;
    }

    eq(): this {
      return this;
    }

    in(): this {
      return this;
    }

    neq(): this {
      this.liveUploadRead = true;
      return this;
    }

    order(): this {
      return this;
    }

    limit(): this {
      return this;
    }

    insert(values: unknown): this {
      this.op = 'insert';
      this.values = values;
      if (this.table === 'schedules') {
        insertedSchedules.push(values as Record<string, unknown>);
        scheduleInsertAttempts += 1;
      }
      if (this.table === 'scheduled_posts') insertedSlots.push(...(values as Record<string, unknown>[]));
      return this;
    }

    update(values: unknown): this {
      this.op = 'update';
      this.values = values;
      return this;
    }

    delete(): this {
      this.op = 'delete';
      return this;
    }

    async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
      if (this.table === 'personas') {
        const next = config.personaReads?.shift();
        if (next !== undefined) return next;
        return { data: config.personaRow ?? null, error: null };
      }
      if (this.table === 'schedules') {
        const visible = !config.raceWinner || scheduleInsertAttempts > 0;
        return { data: visible ? (config.existingSchedule ?? null) : null, error: null };
      }
      return { data: null, error: null };
    }

    async single(): Promise<{ data: unknown; error: unknown }> {
      return { data: null, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      let result: { data: unknown; error: unknown };
      if (this.op === 'insert' && this.table === 'scheduled_posts') {
        result = {
          data: config.slotInsertRows ?? [{ id: 'slot-1', slot_at: '2026-11-20T18:00:00Z', title: 'Ready video' }],
          error: config.slotInsertError ?? null,
        };
      } else if (this.op === 'insert') {
        result = { data: null, error: config.scheduleInsertError ?? null };
      } else if (this.table === 'scheduled_posts' && this.liveUploadRead) {
        result = { data: config.liveUploadSlots ?? [], error: config.liveUploadSlotsError ?? null };
      } else if (this.table === 'scheduled_posts') {
        result = { data: config.existingSlots ?? [], error: null };
      } else if (this.table === 'social_accounts') {
        result = { data: config.socialRows ?? [], error: null };
      } else if (this.table === 'persona_default_accounts') {
        result = { data: config.boundRows ?? [], error: null };
      } else {
        result = { data: null, error: null };
      }
      return Promise.resolve(result).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: vi.fn((table: string) => new Query(table)),
    rpc,
    __rpcCalls: rpcCalls,
    storage: { from: vi.fn(() => ({ upload: storageUpload, remove: storageRemove })) },
    __insertedSchedules: insertedSchedules,
    __insertedSlots: insertedSlots,
    __updatedUploads: updatedUploads,
    __removedPaths: removedPaths,
    __uploadedPaths: uploadedPaths,
  };
  return client;
}

function authAs(personaIds?: string[] | null, isApiKey = false): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'token', personaIds, isApiKey },
    error: null,
  } as never);
}

function mockUploadStore(config: FakeConfig): {
  store: { getUpload: ReturnType<typeof vi.fn>; updateUpload: ReturnType<typeof vi.fn> };
  storage: { download: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
} {
  const store = {
    getUpload: vi.fn(async () => config.uploadRow ?? null),
    updateUpload: vi.fn(async (_id: string, _expected: string, _patch: Record<string, unknown>) => {
      return true;
    }),
  };
  vi.mocked(createSupabaseVideoUploadStore).mockReturnValue(store as never);
  vi.mocked(claimUploadForPublish).mockImplementation(async (_store, _storage, _userId, _uploadId, _now) => {
    if (config.uploadRow === null || config.uploadRow === undefined) {
      throw new VideoUploadError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
    }
    return {
      row: config.uploadRow as unknown as VideoUploadRow,
      buffer: Buffer.from([1, 2, 3]),
      contentType: ((config.uploadRow.declared_content_type as string) ?? 'video/mp4') as VideoUploadContentType,
    };
  });
  const storage = {
    download: vi.fn(async () => ({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
      error: null,
    })),
    remove: vi.fn(async () => ({ error: null })),
  };
  vi.mocked(createSupabaseVideoUploadStorage).mockReturnValue(storage as never);
  return { store, storage };
}

function uploadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UPLOAD_ID,
    user_id: USER_ID,
    storage_path: `${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`,
    declared_content_type: 'video/mp4',
    detected_content_type: 'video/mp4',
    size_bytes: 3,
    status: 'ready',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: '2026-11-14T11:00:00Z',
    consumed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyRateLimit).mockResolvedValue(null);
  mockUploadStore({ uploadRow: uploadRow() });
  authAs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/media/publish-existing', () => {
  it('publishes a ready upload ASAP, claiming it once for all providers', async () => {
    const client = fakeSupabase({
      socialRows: [
        { provider: 'youtube', provider_account_id: 'UC1' },
        { provider: 'instagram', provider_account_id: 'ig-1' },
      ],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const { storage } = mockUploadStore({ uploadRow: uploadRow() });

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: {
          mode: 'asap',
          providers: ['youtube', 'instagram'],
          accounts: { youtube: ['UC1'], instagram: ['ig-1'] },
        },
        tags: ['ready'],
        privacyStatus: 'public',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(dispatchPublish)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(claimUploadForPublish)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(claimUploadForPublish).mock.calls[0]?.[5]).toEqual(['youtube', 'instagram']);
    expect(storage.remove).toHaveBeenCalledWith([`${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`]);
  });

  it('refuses an image upload for a video-only network before claiming it (400 IMAGE_PROVIDER_UNSUPPORTED)', async () => {
    const client = fakeSupabase({ socialRows: [{ provider: 'rumble', provider_account_id: 'rb-1' }] });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const imageRow = uploadRow({ declared_content_type: 'image/jpeg', detected_content_type: 'image/jpeg' });
    mockUploadStore({ uploadRow: imageRow });
    vi.mocked(assertUploadFitsProviders).mockImplementationOnce(() => {
      throw new VideoUploadError('This upload is an image: rumble publishes video only.', 400, 'IMAGE_PROVIDER_UNSUPPORTED');
    });

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Photo',
        description: 'A photo.',
        publishing: { mode: 'asap', providers: ['rumble'], accounts: { rumble: ['rb-1'] } },
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('IMAGE_PROVIDER_UNSUPPORTED');
    expect(vi.mocked(assertUploadFitsProviders)).toHaveBeenCalledWith(imageRow, ['rumble']);
    expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
    expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
  });

  it('keeps the first provider result when a later provider dispatch throws', async () => {
    const client = fakeSupabase({
      socialRows: [
        { provider: 'youtube', provider_account_id: 'UC1' },
        { provider: 'instagram', provider_account_id: 'ig-1' },
      ],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const { storage } = mockUploadStore({ uploadRow: uploadRow() });
    const dispatch = vi.mocked(dispatchPublish);
    const originalImplementation = dispatch.getMockImplementation();
    dispatch.mockImplementation(async (provider: SocialProvider, _form: FormData, _userId: string, _logId: string, _startTime: number) => {
      if (provider === 'instagram') throw new Error('instagram down');
      return {
        success: true,
        provider,
        results: [{ accountId: 'UC1', success: true, videoId: 'vid-1' }],
        logId: 'log-1',
      };
    });
    try {
      const response = await POST(
        jsonRequest({
          media: { kind: 'upload', uploadId: UPLOAD_ID },
          title: 'Ready video',
          description: 'Edited outside.',
          publishing: {
            mode: 'asap',
            providers: ['youtube', 'instagram'],
            accounts: { youtube: ['UC1'], instagram: ['ig-1'] },
          },
          tags: ['ready'],
          privacyStatus: 'public',
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.mode).toBe('asap');
      expect(body.publishes).toHaveLength(2);
      expect(body.publishes[0]).toMatchObject({ provider: 'youtube', success: true });
      expect(body.publishes[1]).toEqual({
        provider: 'instagram',
        success: false,
        results: [{ accountId: 'ig-1', success: false, error: 'instagram down', errorCode: 'transient' }],
      });
      expect(storage.remove).toHaveBeenCalledWith([`${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`]);
    } finally {
      if (originalImplementation !== undefined) {
        dispatch.mockImplementation(originalImplementation);
      }
    }
  });

  it('publishes an image ASAP to instagram through the image handler', async () => {
    const client = fakeSupabase({
      socialRows: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

    const response = await POST(
      jsonRequest({
        media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
        title: 'Sunset photo',
        description: 'Edited photo.',
        publishing: { mode: 'asap', providers: ['instagram'], accounts: { instagram: ['ig-1'] } },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(dispatchPublish)).toHaveBeenCalledTimes(1);
    const [provider, form] = vi.mocked(dispatchPublish).mock.calls[0] ?? [];
    expect(provider).toBe('instagram');
    expect(form?.get('file')).toBeInstanceOf(File);
    expect(form?.get('caption')).toBe('Edited photo.');
  });

  it('publishes an image ASAP to several image networks: the image rides in each form', async () => {
    const client = fakeSupabase({
      socialRows: [
        { provider: 'instagram', provider_account_id: 'ig-1' },
        { provider: 'bluesky', provider_account_id: 'did:plc:a' },
        { provider: 'threads', provider_account_id: 'th-1' },
      ],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

    const response = await POST(
      jsonRequest({
        media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
        title: 'Sunset photo',
        description: 'Edited photo.',
        publishing: {
          mode: 'asap',
          providers: ['instagram', 'bluesky', 'threads'],
          accounts: { instagram: ['ig-1'], bluesky: ['did:plc:a'], threads: ['th-1'] },
        },
      }),
    );
    expect(response.status).toBe(200);
    const calls = vi.mocked(dispatchPublish).mock.calls;
    expect(calls.map(([provider]) => provider)).toEqual(['instagram', 'bluesky', 'threads']);
    for (const [provider, form] of calls) {
      const file = form.get(provider === 'instagram' ? 'file' : 'video');
      expect(file).toBeInstanceOf(File);
      expect((file as File).type).toBe('image/jpeg');
    }
  });

  it('reports a throwing image dispatch as a per-account failure instead of a 500', async () => {
    const client = fakeSupabase({
      socialRows: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const dispatch = vi.mocked(dispatchPublish);
    const originalImplementation = dispatch.getMockImplementation();
    dispatch.mockRejectedValue(new Error('instagram down'));
    try {
      const response = await POST(
        jsonRequest({
          media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
          title: 'Sunset photo',
          description: 'Edited photo.',
          publishing: { mode: 'asap', providers: ['instagram'], accounts: { instagram: ['ig-1'] } },
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.mode).toBe('asap');
      expect(body.publishes).toEqual([
        {
          provider: 'instagram',
          success: false,
          results: [{ accountId: 'ig-1', success: false, error: 'instagram down', errorCode: 'transient' }],
        },
      ]);
    } finally {
      if (originalImplementation !== undefined) {
        dispatch.mockImplementation(originalImplementation);
      }
    }
  });

  it('reports an all-failed handler result as a failed publish instead of trusting the handler flag', async () => {
    const client = fakeSupabase({
      socialRows: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const dispatch = vi.mocked(dispatchPublish);
    const originalImplementation = dispatch.getMockImplementation();
    dispatch.mockResolvedValue({
      success: true,
      provider: 'instagram',
      results: [{ accountId: 'ig-1', success: false, error: 'token revoked' }],
      logId: 'log-1',
    });
    try {
      const response = await POST(
        jsonRequest({
          media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
          title: 'Sunset photo',
          description: 'Edited photo.',
          publishing: { mode: 'asap', providers: ['instagram'], accounts: { instagram: ['ig-1'] } },
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.publishes).toEqual([
        {
          provider: 'instagram',
          success: false,
          results: [{ accountId: 'ig-1', success: false, error: 'token revoked' }],
        },
      ]);
    } finally {
      if (originalImplementation !== undefined) {
        dispatch.mockImplementation(originalImplementation);
      }
    }
  });

  it('schedules a dead account and returns account_needs_reconnect', async () => {
    const publishAt = futurePublishAt(48);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1', needs_reconnect: true }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        idempotencyKey: 'key-dead',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mode).toBe('scheduled');
    expect(body.warnings).toEqual([
      { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] },
    ]);
    expect(client.__insertedSchedules).toHaveLength(1);
  });

  it('schedules a ready upload, holding the row until the slot time', async () => {
    const publishAt = futurePublishAt(48);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const { store } = mockUploadStore({ uploadRow: uploadRow() });

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        tags: ['ready'],
        privacyStatus: 'public',
        idempotencyKey: 'key-2',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const slot = client.__insertedSlots[0] as Record<string, unknown>;
    expect(slot.status).toBe('ready');
    expect(slot).not.toHaveProperty('task_id');
    expect(slot.media_kind).toBe('upload');
    expect(slot.media_ref).toBe(UPLOAD_ID);
    expect(slot.media_content_type).toBe('video/mp4');
    expect(store.updateUpload).toHaveBeenCalledWith(
      UPLOAD_ID,
      'ready',
      expect.objectContaining({ expires_at: expect.any(String) }),
    );
  });

  it('stores the first comment on the scheduled slot', async () => {
    const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    mockUploadStore({ uploadRow: uploadRow() });

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt: futurePublishAt(48), timezone: 'UTC' },
        },
        tags: ['ready'],
        privacyStatus: 'public',
        firstComment: '  Link in bio  ',
        idempotencyKey: 'key-comment',
      }),
    );
    expect(response.status).toBe(200);
    expect((client.__insertedSlots[0] as Record<string, unknown>).first_comment).toBe('Link in bio');
  });

  it('stores no first comment when none is sent', async () => {
    const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    mockUploadStore({ uploadRow: uploadRow() });
    await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: { mode: 'scheduled', providers: ['youtube'], accounts: { youtube: ['UC1'] }, schedule: { publishAt: futurePublishAt(48), timezone: 'UTC' } },
        tags: ['ready'],
        privacyStatus: 'public',
        idempotencyKey: 'key-no-comment',
      }),
    );
    expect((client.__insertedSlots[0] as Record<string, unknown>).first_comment).toBeNull();
  });

  it('answers 400 for an over-length first comment before touching the upload', async () => {
    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['ready'],
        privacyStatus: 'public',
        firstComment: 'x'.repeat(1001),
      }),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('firstComment');
    expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
    expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
  });

  it('sends the first comment to the handler form of an ASAP publish', async () => {
    const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }, { provider: 'pinterest', provider_account_id: 'p1' }] });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    mockUploadStore({ uploadRow: uploadRow() });
    await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['ready'],
        privacyStatus: 'public',
        firstComment: 'Link in bio',
      }),
    );
    const form = vi.mocked(dispatchPublish).mock.calls[0]?.[1] as FormData;
    expect(form.get('firstComment')).toBe('Link in bio');
  });

  it('replays the winner of a schedule primary-key race instead of failing', async () => {
    const publishAt = futurePublishAt(48);
    const scheduleId = deterministicUuid('publish-existing/v1', `${USER_ID}:key-race`);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      existingSchedule: { id: scheduleId },
      existingSlots: [{ id: 'slot-1', slot_at: publishAt, title: 'Porto walk', media_kind: 'upload', media_ref: UPLOAD_ID, status: 'ready' }],
      raceWinner: true,
      scheduleInsertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "schedules_pkey"',
      },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        idempotencyKey: 'key-race',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.schedule.id).toBe(scheduleId);
    expect(client.__insertedSlots).toHaveLength(0);
  });

  it('logs a failed cleanup of the stored image when the schedule insert fails, and still answers 500', async () => {
    const publishAt = futurePublishAt(48);
    const client = fakeSupabase({
      socialRows: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
      scheduleInsertError: { code: '23503', message: 'insert or update on table "schedules" violates foreign key constraint' },
      storageRemoveError: new Error('storage unavailable'),
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

    const response = await POST(
      jsonRequest({
        media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
        title: 'Sunset photo',
        description: 'Edited photo.',
        publishing: {
          mode: 'scheduled',
          providers: ['instagram'],
          accounts: { instagram: ['ig-1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        idempotencyKey: 'key-cleanup-fail',
      }),
    );
    expect(response.status).toBe(500);
    expect(client.__uploadedPaths).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[publish-existing] stored image cleanup failed',
      expect.any(Error),
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it('schedules an image, storing the bytes and pointing the slot at them', async () => {
    const publishAt = futurePublishAt(48);
    const client = fakeSupabase({
      socialRows: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

    const response = await POST(
      jsonRequest({
        media: { kind: 'image', imageData: jpeg.toString('base64'), contentType: 'image/jpeg' },
        title: 'Sunset photo',
        description: 'Edited photo.',
        publishing: {
          mode: 'scheduled',
          providers: ['instagram'],
          accounts: { instagram: ['ig-1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        idempotencyKey: 'key-3',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(client.__uploadedPaths).toHaveLength(1);
    expect(client.__uploadedPaths[0]?.startsWith(`scheduled-media/${USER_ID}/`)).toBe(true);
    const slot = client.__insertedSlots[0] as Record<string, unknown>;
    expect(slot.status).toBe('ready');
    expect(slot.media_kind).toBe('image');
    expect(slot.media_ref).toBe(client.__uploadedPaths[0]);
    expect(slot.media_content_type).toBe('image/jpeg');
  });

  it('replays a scheduled request with the same idempotency key', async () => {
    const publishAt = futurePublishAt(48);
    const scheduleId = deterministicUuid('publish-existing/v1', `${USER_ID}:key-1`);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      existingSchedule: { id: scheduleId },
      existingSlots: [
        { id: 'slot-1', slot_at: publishAt, title: 'Porto walk', media_kind: 'upload', media_ref: UPLOAD_ID, status: 'ready' },
      ],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
        idempotencyKey: 'key-1',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.schedule.id).toBe(scheduleId);
    expect(client.__insertedSchedules).toHaveLength(0);
    expect(client.__insertedSlots).toHaveLength(0);
  });

  it('answers 404 for an unknown upload id', async () => {
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    mockUploadStore({ uploadRow: null });

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['ready'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('VIDEO_UPLOAD_NOT_FOUND');
  });

  it('answers 403 when a scoped key names a persona outside its scope', async () => {
    authAs(['other-persona'], true);
    const client = fakeSupabase();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        personaId: PERSONA_ID,
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('PERSONA_SCOPE_DENIED');
  });

  const boundRequest = () =>
    jsonRequest({
      media: { kind: 'upload', uploadId: UPLOAD_ID },
      title: 'Porto walk',
      description: 'Walking the riverside.',
      personaId: PERSONA_ID,
      publishing: { mode: 'asap', providers: ['youtube'] },
      tags: ['porto'],
      privacyStatus: 'public',
    });

  it('answers 404 PERSONA_NOT_FOUND for a persona the caller does not own', async () => {
    const client = fakeSupabase({
      personaRow: null,
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(boundRequest());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('PERSONA_NOT_FOUND');
  });

  it('answers a logged 500 when the first persona read fails', async () => {
    const dbError = { message: 'db down' };
    const client = fakeSupabase({
      personaReads: [{ data: null, error: dbError }],
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(boundRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith('[publish-existing] persona lookup failed', dbError, { userId: USER_ID });
  });

  it('answers 404 PERSONA_NOT_FOUND when the persona is gone by the binding read', async () => {
    const client = fakeSupabase({
      personaReads: [{ data: { id: PERSONA_ID }, error: null }, { data: null, error: null }],
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(boundRequest());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('PERSONA_NOT_FOUND');
  });

  it('answers a logged 500 when the binding ownership read fails', async () => {
    const dbError = { message: 'connection reset' };
    const client = fakeSupabase({
      personaReads: [{ data: { id: PERSONA_ID }, error: null }, { data: null, error: dbError }],
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(boundRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      '[publish-existing] persona lookup failed',
      expect.objectContaining({ message: 'Failed to load persona: connection reset' }),
      { userId: USER_ID },
    );
  });

  it('answers 400 when a persona has no bound accounts and none are given', async () => {
    const client = fakeSupabase({
      personaRow: { id: PERSONA_ID },
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      boundRows: [],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        personaId: PERSONA_ID,
        publishing: { mode: 'asap', providers: ['youtube'] },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('PERSONA_NO_BOUND_ACCOUNTS');
  });

  it('answers 400 for an account that is not bound to the persona', async () => {
    const client = fakeSupabase({
      personaRow: { id: PERSONA_ID },
      socialRows: [
        { provider: 'youtube', provider_account_id: 'UC1' },
        { provider: 'youtube', provider_account_id: 'UC2' },
      ],
      boundRows: [{ provider: 'youtube', provider_account_id: 'UC2' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        personaId: PERSONA_ID,
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('ACCOUNT_NOT_BOUND_TO_PERSONA');
  });

  describe('persona ai_label lookup', () => {
    it('labels the form as AI-made when the persona opts in', async () => {
      const client = fakeSupabase({
        personaRow: { id: PERSONA_ID, ai_label: true },
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await POST(boundRequest());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      const form = vi.mocked(dispatchPublish).mock.calls[0]?.[1] as FormData;
      expect(form.get('aiLabel')).toBe('true');
    });

    it('labels the form as not AI-made when the persona opts out', async () => {
      const client = fakeSupabase({
        personaRow: { id: PERSONA_ID, ai_label: false },
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await POST(boundRequest());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      const form = vi.mocked(dispatchPublish).mock.calls[0]?.[1] as FormData;
      expect(form.get('aiLabel')).toBe('false');
    });

    it('answers a logged 500 and releases the publish ledger when the ai_label lookup fails', async () => {
      const dbError = { message: 'db down' };
      const client = fakeSupabase({
        personaReads: [
          { data: { id: PERSONA_ID }, error: null },
          { data: { id: PERSONA_ID }, error: null },
          { data: null, error: dbError },
        ],
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await POST(
        jsonRequest({
          media: { kind: 'upload', uploadId: UPLOAD_ID },
          title: 'Porto walk',
          description: 'Walking the riverside.',
          personaId: PERSONA_ID,
          publishing: { mode: 'asap', providers: ['youtube'] },
          tags: ['porto'],
          privacyStatus: 'public',
          idempotencyKey: 'ai-label-key',
        }),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(logger.error).toHaveBeenCalledWith('[publish-existing] persona ai_label lookup failed', dbError, { userId: USER_ID });
      expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
      const releases = client.__rpcCalls.filter(
        (call) => call.fn === 'record_publish_ledger' && call.args.p_status === 'failed',
      );
      expect(releases).toHaveLength(1);
    });

    it('schedules without the ai_label lookup when the persona read would fail', async () => {
      const publishAt = futurePublishAt(48);
      const dbError = { message: 'db down' };
      const client = fakeSupabase({
        personaReads: [
          { data: { id: PERSONA_ID }, error: null },
          { data: { id: PERSONA_ID }, error: null },
          { data: null, error: dbError },
        ],
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        boundRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await POST(
        jsonRequest({
          media: { kind: 'upload', uploadId: UPLOAD_ID },
          title: 'Porto walk',
          description: 'Walking the riverside.',
          personaId: PERSONA_ID,
          publishing: {
            mode: 'scheduled',
            providers: ['youtube'],
            accounts: { youtube: ['UC1'] },
            schedule: { publishAt, timezone: 'UTC' },
          },
          idempotencyKey: 'key-ai-label-scheduled',
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.mode).toBe('scheduled');
      expect(client.__insertedSchedules).toHaveLength(1);
    });
  });

  it('answers 400 for a schedule inside the 3h lead time', async () => {
    const publishAt = futurePublishAt(1);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: {
          mode: 'scheduled',
          providers: ['youtube'],
          accounts: { youtube: ['UC1'] },
          schedule: { publishAt, timezone: 'UTC' },
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('SCHEDULE_OUT_OF_RANGE');
    expect(client.__insertedSchedules).toHaveLength(0);
  });

  it('answers 401 without a session and 429 when rate limited', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }) } as never);
    const unauth = await POST(jsonRequest({ media: { kind: 'upload', uploadId: UPLOAD_ID }, title: 'T', description: 'D', publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } }, tags: ['t'], privacyStatus: 'public' }));
    expect(unauth.status).toBe(401);

    authAs();
    vi.mocked(applyRateLimit).mockResolvedValue(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const limited = await POST(jsonRequest({ media: { kind: 'upload', uploadId: UPLOAD_ID }, title: 'T', description: 'D', publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } }, tags: ['t'], privacyStatus: 'public' }));
    expect(limited.status).toBe(429);
  });

  it('answers 402 and neither claims nor schedules once the free trial has ended', async () => {
    const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    vi.mocked(assertTrialActive).mockResolvedValueOnce(
      NextResponse.json({ success: false, code: 'TRIAL_EXPIRED' }, { status: 402 }),
    );
    const response = await POST(jsonRequest({ media: { kind: 'upload', uploadId: UPLOAD_ID }, title: 'T', description: 'D', publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } }, tags: ['t'], privacyStatus: 'public' }));
    expect(response.status).toBe(402);
    expect(vi.mocked(assertTrialActive)).toHaveBeenCalledWith(USER_ID, { route: 'POST /api/media/publish-existing' });
    expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
    expect(client.__insertedSchedules).toHaveLength(0);
  });

  describe('publishAt', () => {
    function scheduledUploadBody(schedule: Record<string, unknown>): Record<string, unknown> {
      return {
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: { mode: 'scheduled', providers: ['youtube'], accounts: { youtube: ['UC1'] }, schedule },
      };
    }

    beforeEach(() => {
    });

    it('places the slot on publishAt\'s minute, wall-clock in the timezone', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const at = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const local = new Date(at.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
      const response = await POST(jsonRequest(scheduledUploadBody({ publishAt: `${local}:42`, timezone: 'America/Sao_Paulo' })));
      expect(response.status).toBe(200);
      const slot = client.__insertedSlots[0] as Record<string, unknown>;
      expect(slot.slot_at).toBe(new Date(`${local}:00-03:00`).toISOString());
      expect(client.__insertedSchedules[0]?.times).toEqual([local.slice(11, 16)]);
      expect(client.__insertedSchedules[0]?.timezone).toBe('America/Sao_Paulo');
    });

    it('answers 400 for an unknown timezone and for a publishAt that is not a datetime', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const badZone = await POST(jsonRequest(scheduledUploadBody({ publishAt: futurePublishAt(48), timezone: 'Mars/Olympus' })));
      expect(badZone.status).toBe(400);
      expect((await badZone.json()).field).toBe('publishing.schedule.timezone');
      const badAt = await POST(jsonRequest(scheduledUploadBody({ publishAt: 'next friday', timezone: 'UTC' })));
      expect(badAt.status).toBe(400);
      expect((await badAt.json()).field).toBe('publishing.schedule.publishAt');
      expect(client.__insertedSchedules).toHaveLength(0);
    });

    it('rejects the old start + times shape', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const response = await POST(
        jsonRequest(scheduledUploadBody({ startAt: futurePublishAt(48), times: ['09:00', '20:00'], timezone: 'UTC' })),
      );
      expect(response.status).toBe(400);
      expect(client.__insertedSchedules).toHaveLength(0);
    });
  });

  describe('one live slot per upload', () => {
    function uploadBody(mode: 'asap' | 'scheduled'): Record<string, unknown> {
      return {
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing:
          mode === 'asap'
            ? { mode, providers: ['youtube'], accounts: { youtube: ['UC1'] } }
            : { mode, providers: ['youtube'], accounts: { youtube: ['UC1'] }, schedule: { publishAt: futurePublishAt(48), timezone: 'UTC' } },
        tags: ['ready'],
        privacyStatus: 'public',
      };
    }

    it.each(['scheduled', 'asap'] as const)('answers 409 VIDEO_UPLOAD_SCHEDULED in %s mode when a live slot holds the upload', async (mode) => {
      const client = fakeSupabase({
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        liveUploadSlots: [{ id: 'slot-held' }],
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const { store } = mockUploadStore({ uploadRow: uploadRow() });

      const response = await POST(jsonRequest(uploadBody(mode)));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('VIDEO_UPLOAD_SCHEDULED');
      expect(store.updateUpload).not.toHaveBeenCalled();
      expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
      expect(client.__insertedSchedules).toHaveLength(0);
    });

    it('answers 409 and removes the schedule row when a concurrent call wins the slot index', async () => {
      const client = fakeSupabase({
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        slotInsertError: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "scheduled_posts_upload_media_ref_key"',
        },
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });
      const deletes: string[] = [];
      const from = client.from;
      client.from = vi.fn((table: string) => {
        const query = from(table);
        const del = query.delete.bind(query);
        query.delete = () => {
          deletes.push(table);
          return del();
        };
        return query;
      });

      const response = await POST(jsonRequest(uploadBody('scheduled')));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('VIDEO_UPLOAD_SCHEDULED');
      expect(deletes).toEqual(['schedules']);
    });

    it('answers 500 when the live-slot read fails, instead of scheduling blind', async () => {
      const client = fakeSupabase({
        socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
        liveUploadSlotsError: { message: 'connection reset' },
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });

      const response = await POST(jsonRequest(uploadBody('scheduled')));
      expect(response.status).toBe(500);
      expect(client.__insertedSchedules).toHaveLength(0);
    });
  });

  describe('ASAP idempotency (publish ledger)', () => {
    function asapUploadBody(): Record<string, unknown> {
      return {
        media: { kind: 'upload', uploadId: UPLOAD_ID },
        title: 'Ready video',
        description: 'Edited outside.',
        publishing: { mode: 'asap', providers: ['youtube', 'instagram'], accounts: { youtube: ['UC1'], instagram: ['ig-1'] } },
        tags: ['ready'],
        privacyStatus: 'public',
        idempotencyKey: 'asap-key-1',
      };
    }

    const recordedYoutube = { accountId: 'UC1', success: true, videoId: 'vid-1' };
    const recordedInstagram = { accountId: 'ig-1', success: true, mediaId: 'm-1' };

    function socialRows(): Record<string, unknown>[] {
      return [
        { provider: 'youtube', provider_account_id: 'UC1' },
        { provider: 'instagram', provider_account_id: 'ig-1' },
      ];
    }

    it('replays a retry whose accounts all published, without loading or claiming the upload', async () => {
      const client = fakeSupabase({
        socialRows: socialRows(),
        uploadRow: uploadRow({ status: 'consumed' }),
        ledgerClaims: {
          UC1: { outcome: 'published', result: recordedYoutube },
          'ig-1': { outcome: 'published', result: recordedInstagram },
        },
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow({ status: 'consumed' }) });

      const response = await POST(jsonRequest(asapUploadBody()));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ success: true, mode: 'asap', replayed: true });
      expect(body.publishes).toEqual([
        { provider: 'youtube', success: true, results: [recordedYoutube] },
        { provider: 'instagram', success: true, results: [recordedInstagram] },
      ]);
      expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
      expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
      const scopeId = deterministicUuid('publish-existing/v1', `${USER_ID}:asap-key-1`);
      expect(client.__rpcCalls[0]?.args.p_key).toBe(`publish:direct:existing:${scopeId}:youtube:UC1`);
    });

    it('publishes only the accounts with no recorded success and records their outcome', async () => {
      const client = fakeSupabase({
        socialRows: socialRows(),
        ledgerClaims: { UC1: { outcome: 'published', result: recordedYoutube } },
      });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });
      vi.mocked(dispatchPublish).mockResolvedValueOnce({
        success: true,
        provider: 'instagram',
        results: [recordedInstagram],
        logId: 'log-1',
      });

      const response = await POST(jsonRequest(asapUploadBody()));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ success: true, replayed: false });
      expect(vi.mocked(dispatchPublish)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(dispatchPublish).mock.calls[0]?.[0]).toBe('instagram');
      expect(body.publishes[0]).toEqual({ provider: 'youtube', success: true, results: [recordedYoutube] });
      const records = client.__rpcCalls.filter((call) => call.fn === 'record_publish_ledger');
      expect(records).toHaveLength(1);
      expect(records[0]?.args).toMatchObject({ p_status: 'published' });
    });

    it('answers 500 and publishes nothing when the ledger claim fails', async () => {
      const client = fakeSupabase({ socialRows: socialRows(), ledgerClaimError: { message: 'rpc down' } });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });

      const response = await POST(jsonRequest(asapUploadBody()));
      expect(response.status).toBe(500);
      expect(vi.mocked(claimUploadForPublish)).not.toHaveBeenCalled();
      expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
    });

    it('releases the claims as failed when the media cannot be verified', async () => {
      const client = fakeSupabase({ socialRows: socialRows() });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: null });

      const response = await POST(jsonRequest(asapUploadBody()));
      expect(response.status).toBe(404);
      const records = client.__rpcCalls.filter((call) => call.fn === 'record_publish_ledger');
      expect(records).toHaveLength(2);
      expect(records.every((call) => call.args.p_status === 'failed')).toBe(true);
    });

    it('releases a provider\'s claims as failed when its handler throws', async () => {
      const client = fakeSupabase({ socialRows: socialRows() });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });
      vi.mocked(dispatchPublish)
        .mockResolvedValueOnce({ success: true, provider: 'youtube', results: [recordedYoutube], logId: 'log-1' })
        .mockRejectedValueOnce(new Error('instagram down'));

      const response = await POST(jsonRequest(asapUploadBody()));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.publishes[1]).toEqual({
        provider: 'instagram',
        success: false,
        results: [{ accountId: 'ig-1', success: false, error: 'instagram down', errorCode: 'transient' }],
      });
      const records = client.__rpcCalls.filter((call) => call.fn === 'record_publish_ledger');
      expect(records.map((call) => call.args.p_status)).toEqual(['published', 'failed']);
    });

    it('publishes without the ledger when the caller sends no key', async () => {
      const client = fakeSupabase({ socialRows: socialRows() });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      mockUploadStore({ uploadRow: uploadRow() });
      const { idempotencyKey: _omitted, ...body } = asapUploadBody();

      const response = await POST(jsonRequest(body));
      expect(response.status).toBe(200);
      expect(client.__rpcCalls).toHaveLength(0);
      expect(vi.mocked(dispatchPublish)).toHaveBeenCalledTimes(2);
    });
  });
});
