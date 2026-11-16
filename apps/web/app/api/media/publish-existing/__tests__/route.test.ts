// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

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
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  VideoUploadError,
  claimUploadForPublish,
  createSupabaseVideoUploadStore,
  createSupabaseVideoUploadStorage,
  type VideoUploadContentType,
  type VideoUploadRow,
} from '@/lib/videos/signed-upload';
import { dispatchPublish } from '@/lib/videos/publish-uploaded';
import type { SocialProvider } from '@/lib/providers/registry';
import { deterministicUuid } from '@/lib/idempotency';

const USER_ID = 'user-uuid-1';
const TASK_ID = '11111111-1111-4111-8111-111111111111';
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
  // Whole minutes: the slot lands on publishAt's minute, so a test can
  // compare the slot time with the instant it sent.
  const at = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  at.setUTCSeconds(0, 0);
  return at.toISOString();
}

function taskEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'success',
    message: 'ok',
    body: {
      state: 1,
      videos: ['final-1.mp4'],
      final_video: `https://engine.example.com/api/v1/download/${TASK_ID}/final-1.mp4`,
      has_archive: true,
      ...overrides,
    },
  };
}

interface FakeConfig {
  personaRow?: Record<string, unknown> | null;
  socialRows?: Record<string, unknown>[];
  boundRows?: Record<string, unknown>[];
  existingSchedule?: Record<string, unknown> | null;
  existingSlots?: Record<string, unknown>[];
  scheduleInsertError?: unknown;
  slotInsertError?: unknown;
  slotInsertRows?: Record<string, unknown>[];
  storageUpload?: { data: { path: string } | null; error: { message: string } | null };
  uploadRow?: Record<string, unknown> | null;
  /** Live slots already holding the upload (the migration 065 guard read). */
  liveUploadSlots?: Record<string, unknown>[];
  liveUploadSlotsError?: unknown;
  /** claim_publish_ledger outcome per account id (default: claimed). */
  ledgerClaims?: Record<string, Record<string, unknown>>;
  ledgerClaimError?: unknown;
}

function fakeSupabase(config: FakeConfig = {}) {
  const insertedSchedules: Record<string, unknown>[] = [];
  const insertedSlots: Record<string, unknown>[] = [];
  const updatedUploads: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const removedPaths: string[] = [];
  const uploadedPaths: string[] = [];
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
      if (this.table === 'schedules') insertedSchedules.push(values as Record<string, unknown>);
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
      if (this.table === 'personas') return { data: config.personaRow ?? null, error: null };
      if (this.table === 'schedules') return { data: config.existingSchedule ?? null, error: null };
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
    // Relative to now: a fixed date turns into an expired upload once the
    // clock passes it (410 VIDEO_UPLOAD_EXPIRED) and breaks every test
    // below that publishes a ready upload.
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: '2026-11-14T11:00:00Z',
    consumed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.example.com');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'secret-1');
  // clearAllMocks keeps implementations: undo the 429 test's limiter.
  vi.mocked(applyRateLimit).mockResolvedValue(null);
  authAs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/media/publish-existing', () => {
  it('publishes a finished task video ASAP through the provider handlers', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/tasks/')) return new Response(JSON.stringify(taskEnvelope()), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'video/mp4' } });
    });
    vi.stubGlobal('fetch', fetchFn);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mode).toBe('asap');
    expect(vi.mocked(dispatchPublish)).toHaveBeenCalledTimes(1);
    const form = vi.mocked(dispatchPublish).mock.calls[0]?.[1] as FormData;
    expect(form.get('provider')).toBe('youtube');
    expect(form.get('video')).toBeInstanceOf(File);
    expect(client.__insertedSchedules).toHaveLength(0);
  });

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
    // Claimed exactly once for all providers, then the bytes are removed.
    expect(vi.mocked(claimUploadForPublish)).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([`${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`]);
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
      // The single-use upload was still cleaned up after dispatch.
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
    // YouTube/Instagram handlers return success: true even when every
    // account failed; the route must derive the outcome from results, or
    // the MCP summary claims a publish that never happened.
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

  it('schedules a finished task video as a ready slot with no charge', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(taskEnvelope()), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    const publishAt = futurePublishAt(48);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
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
    expect(body.success).toBe(true);
    expect(body.mode).toBe('scheduled');
    expect(body.schedule.id).toBe(deterministicUuid('publish-existing/v1', `${USER_ID}:key-1`));
    expect(client.__insertedSchedules).toHaveLength(1);
    expect(client.__insertedSchedules[0]?.publish_mode).toBe('scheduled');
    expect(client.__insertedSlots).toHaveLength(1);
    const slot = client.__insertedSlots[0] as Record<string, unknown>;
    expect(slot.status).toBe('ready');
    expect(slot.task_id).toBe(TASK_ID);
    expect(slot.charged_tokens).toBe(0);
    expect(slot.media_kind).toBeNull();
    // One post at publishAt itself, and the schedule row names its time.
    expect(slot.slot_at).toBe(publishAt);
    expect(client.__insertedSchedules[0]?.times).toEqual([publishAt.slice(11, 16)]);
    expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
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
    expect(slot.task_id).toBeNull();
    expect(slot.media_kind).toBe('upload');
    expect(slot.media_ref).toBe(UPLOAD_ID);
    expect(slot.media_content_type).toBe('video/mp4');
    expect(store.updateUpload).toHaveBeenCalledWith(
      UPLOAD_ID,
      'ready',
      expect.objectContaining({ expires_at: expect.any(String) }),
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
        { id: 'slot-1', slot_at: publishAt, title: 'Porto walk', task_id: TASK_ID, status: 'ready' },
      ],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(taskEnvelope()), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
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

  it('answers 404 for an unknown task id', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'error' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchFn);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('MEDIA_NOT_FOUND');
    expect(vi.mocked(dispatchPublish)).not.toHaveBeenCalled();
  });

  it('answers 400 for a task that has not finished', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(taskEnvelope({ state: 4, videos: [] })), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } },
        tags: ['porto'],
        privacyStatus: 'public',
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('MEDIA_NOT_READY');
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
        media: { kind: 'task', taskId: TASK_ID },
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

  it('answers 400 when a persona has no bound accounts and none are given', async () => {
    const client = fakeSupabase({
      personaRow: { id: PERSONA_ID },
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
      boundRows: [],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
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
        media: { kind: 'task', taskId: TASK_ID },
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

  it('answers 400 for a schedule inside the 3h lead time', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(taskEnvelope()), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    const publishAt = futurePublishAt(1);
    const client = fakeSupabase({
      socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }],
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await POST(
      jsonRequest({
        media: { kind: 'task', taskId: TASK_ID },
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
    const unauth = await POST(jsonRequest({ media: { kind: 'task', taskId: TASK_ID }, title: 'T', description: 'D', publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } }, tags: ['t'], privacyStatus: 'public' }));
    expect(unauth.status).toBe(401);

    authAs();
    vi.mocked(applyRateLimit).mockResolvedValue(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const limited = await POST(jsonRequest({ media: { kind: 'task', taskId: TASK_ID }, title: 'T', description: 'D', publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['UC1'] } }, tags: ['t'], privacyStatus: 'public' }));
    expect(limited.status).toBe(429);
  });

  describe('publishAt', () => {
    function scheduledTaskBody(schedule: Record<string, unknown>): Record<string, unknown> {
      return {
        media: { kind: 'task', taskId: TASK_ID },
        title: 'Porto walk',
        description: 'Walking the riverside.',
        publishing: { mode: 'scheduled', providers: ['youtube'], accounts: { youtube: ['UC1'] }, schedule },
      };
    }

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(taskEnvelope()), { status: 200 })));
    });

    it('places the slot on publishAt\'s minute, wall-clock in the timezone', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const at = new Date(Date.now() + 48 * 60 * 60 * 1000);
      // A naive local time in Sao Paulo (UTC-3, no DST) with seconds: the
      // seconds are dropped, never rolled to the next day.
      const local = new Date(at.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
      const response = await POST(jsonRequest(scheduledTaskBody({ publishAt: `${local}:42`, timezone: 'America/Sao_Paulo' })));
      expect(response.status).toBe(200);
      const slot = client.__insertedSlots[0] as Record<string, unknown>;
      expect(slot.slot_at).toBe(new Date(`${local}:00-03:00`).toISOString());
      expect(client.__insertedSchedules[0]?.times).toEqual([local.slice(11, 16)]);
      expect(client.__insertedSchedules[0]?.timezone).toBe('America/Sao_Paulo');
    });

    it('answers 400 for an unknown timezone and for a publishAt that is not a datetime', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const badZone = await POST(jsonRequest(scheduledTaskBody({ publishAt: futurePublishAt(48), timezone: 'Mars/Olympus' })));
      expect(badZone.status).toBe(400);
      expect((await badZone.json()).field).toBe('publishing.schedule.timezone');
      const badAt = await POST(jsonRequest(scheduledTaskBody({ publishAt: 'next friday', timezone: 'UTC' })));
      expect(badAt.status).toBe(400);
      expect((await badAt.json()).field).toBe('publishing.schedule.publishAt');
      expect(client.__insertedSchedules).toHaveLength(0);
    });

    it('rejects the old start + times shape', async () => {
      const client = fakeSupabase({ socialRows: [{ provider: 'youtube', provider_account_id: 'UC1' }] });
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      const response = await POST(
        jsonRequest(scheduledTaskBody({ startAt: futurePublishAt(48), times: ['09:00', '20:00'], timezone: 'UTC' })),
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
        // The first call consumed the upload: loading it now would 409.
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
      // The scope key is user-bound through the deterministic id.
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
