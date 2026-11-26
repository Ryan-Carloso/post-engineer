// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id'), generateLogId: vi.fn(() => 'log-1') },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

const mockClaimAsapLedger = vi.hoisted(() =>
  vi.fn(async (_scopeKey: string, _userId: string, _providers: unknown, _accountIds: unknown) => ({ client: {}, partitions: new Map() })),
);
const mockHasGrantedAccounts = vi.hoisted(() => vi.fn(() => true));
const mockReleaseAsapLedger = vi.hoisted(() => vi.fn(async (_ledger: unknown, _error: unknown) => {}));
const mockPublishHeldMedia = vi.hoisted(() =>
  vi.fn(async (_ctx: unknown, _ledger: unknown): Promise<ProviderPublish[]> => [
    {
      provider: 'youtube',
      success: true,
      results: [{ accountId: 'UC1', success: true, videoId: 'vid-1', videoUrl: 'https://youtube.com/watch?v=vid-1' }],
    },
  ]),
);
vi.mock('@/app/api/media/publish-existing/asap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/media/publish-existing/asap')>();
  return {
    ...actual,
    claimAsapLedger: mockClaimAsapLedger,
    hasGrantedAccounts: mockHasGrantedAccounts,
    publishHeldMedia: mockPublishHeldMedia,
    releaseAsapLedger: mockReleaseAsapLedger,
  };
});

const mockGetUpload = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      id: string;
      user_id: string;
      storage_path: string;
      declared_content_type: string;
      detected_content_type: string;
      status: string;
      expires_at: string;
    } | null> => ({
      id: 'upload-1',
      user_id: 'user-1',
      storage_path: 'user-1/direct-uploads/upload-1.mp4',
      declared_content_type: 'video/mp4',
      detected_content_type: 'video/mp4',
      status: 'ready',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  ),
);
const mockUpdateUpload = vi.hoisted(() =>
  vi.fn(async (_id: string, _expected: string, _patch: Record<string, unknown>) => true),
);
vi.mock('@/lib/videos/signed-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/videos/signed-upload')>();
  return {
    ...actual,
    createSupabaseVideoUploadStore: () => ({ getUpload: mockGetUpload, updateUpload: mockUpdateUpload }),
  };
});

import { publishHeldSlot, type HeldSlot } from '../publish-held';
import { VideoUploadError } from '@/lib/videos/signed-upload';
import { PartialPublishError, type ProviderPublish } from '@/app/api/media/publish-existing/asap';

const USER_ID = 'user-1';
const ROUTE = 'POST /api/schedule/slots/[slotId]/approve';
const VIDEO_UPLOAD_TTL_MS = 15 * 60 * 1000;

const futureSlotAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const awaitingSlot: HeldSlot = {
  id: 'slot-1',
  schedule_id: 's1',
  status: 'awaiting_approval',
  title: 'Held video',
  description: 'Edited outside.',
  slot_at: futureSlotAt(),
  media_ref: 'upload-1',
  media_kind: 'upload',
  media_content_type: 'video/mp4',
};

const scheduleRow = {
  id: 's1',
  user_id: USER_ID,
  persona_id: 'p1',
  providers: ['youtube'],
  pinterest_board_id: null,
  youtube_account_ids: ['UC1'],
  instagram_account_ids: [],
  bluesky_account_ids: [],
  linkedin_account_ids: [],
  threads_account_ids: [],
  facebook_account_ids: [],
  pinterest_account_ids: [],
  threespeak_account_ids: [],
  rumble_account_ids: [],
  fanvue_account_ids: [],
  telegram_account_ids: [],
};

interface ChainCall {
  table: string;
  op: string;
  args: unknown[];
}

function mockServiceClient(options: {
  schedule?: unknown;
  scheduleError?: unknown;
  persona?: unknown;
  personaError?: unknown;
  claimConflict?: boolean;
  download?: unknown;
} = {}) {
  const calls: ChainCall[] = [];
  const updates: Array<{ patch: Record<string, unknown> }> = [];
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const track = (op: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      });
    Object.assign(chain, {
      select: track('select'),
      eq: track('eq'),
      in: track('in'),
      order: track('order'),
      update: vi.fn((patch: Record<string, unknown>) => {
        calls.push({ table, op: 'update', args: [patch] });
        updates.push({ patch });
        return chain;
      }),
      maybeSingle: vi.fn(async () => {
        if (table === 'schedules')
          return { data: 'schedule' in options ? options.schedule : scheduleRow, error: options.scheduleError ?? null };
        if (table === 'personas') return { data: options.persona ?? { ai_label: true }, error: options.personaError ?? null };
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        const updateCount = calls.filter((c) => c.table === 'scheduled_posts' && c.op === 'update').length;
        if (options.claimConflict === true && updateCount === 1) return { data: null, error: { code: 'PGRST116' } };
        return { data: { id: 'slot-1' }, error: null };
      }),
    });
    return chain;
  };
  const storageDownload = vi.fn(
    async () =>
      options.download ?? {
        data: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }),
        error: null,
      },
  );
  const client = {
    from: vi.fn((table: string) => makeChain(table)),
    storage: { from: vi.fn(() => ({ download: storageDownload })) },
  };
  return { client, calls, updates, storageDownload };
}

function request(): Request {
  return new Request('https://example.com/api/schedule/slots/slot-1/approve', { method: 'POST' });
}

describe('publishHeldSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a held video upload and records published outcomes', async () => {
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; status: string; publishes: unknown };
    expect(body.success).toBe(true);
    expect(body.status).toBe('published');
    expect(mockUpdateUpload).toHaveBeenCalledWith(
      'upload-1',
      'ready',
      expect.objectContaining({ expires_at: expect.any(String) }),
    );
    const expiresAt = String((mockUpdateUpload.mock.calls[0]?.[2] as { expires_at?: string } | undefined)?.expires_at ?? '');
    expect(Math.abs(Date.parse(expiresAt) - (Date.now() + VIDEO_UPLOAD_TTL_MS))).toBeLessThan(60_000);
    const ledgerArgs = mockClaimAsapLedger.mock.calls[0];
    expect(ledgerArgs?.[0]).toBe('direct:existing:slot-1');
    expect(ledgerArgs?.[1]).toBe(USER_ID);
    expect(ledgerArgs?.[2]).toEqual(['youtube']);
    expect((ledgerArgs?.[3] as Record<string, string[]>)?.youtube).toEqual(['UC1']);
    const claim = updates[0]?.patch as Record<string, unknown>;
    expect(claim.status).toBe('publishing');
    const final = updates[1]?.patch as Record<string, unknown>;
    expect(final.status).toBe('published');
    expect(final.published_at).toEqual(expect.any(String));
    const outcomes = final.publish_outcomes as Array<Record<string, unknown>>;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      provider: 'youtube',
      accountId: 'UC1',
      status: 'published',
      code: null,
      requiresUser: false,
      videoUrl: 'https://youtube.com/watch?v=vid-1',
    });
    const heldCtx = mockPublishHeldMedia.mock.calls[0]?.[0] as { aiLabel?: boolean; uploadRow?: { id?: string } } | undefined;
    expect(heldCtx?.aiLabel).toBe(true);
    expect(heldCtx?.uploadRow?.id).toBe('upload-1');
  });

  it('marks the slot failed when every provider fails, without a published_at', async () => {
    mockPublishHeldMedia.mockResolvedValueOnce([
      {
        provider: 'youtube',
        success: false,
        results: [{ accountId: 'UC1', success: false, error: 'Bluesky token expired', errorCode: 'token_expired' }],
      },
    ]);
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('failed');
    const final = updates[1]?.patch as Record<string, unknown>;
    expect(final.status).toBe('failed');
    expect(final).not.toHaveProperty('published_at');
    const outcomes = final.publish_outcomes as Array<Record<string, unknown>>;
    expect(outcomes[0]).toMatchObject({
      provider: 'youtube',
      accountId: 'UC1',
      status: 'failed',
      code: 'token_expired',
      requiresUser: true,
    });
  });

  it('marks a partial failure published and keeps the failed outcome', async () => {
    mockPublishHeldMedia.mockResolvedValueOnce([
      {
        provider: 'youtube',
        success: true,
        results: [{ accountId: 'UC1', success: true, videoId: 'vid-1' }],
      },
      {
        provider: 'instagram',
        success: false,
        results: [{ accountId: 'ig-1', success: false, error: 'boom', errorCode: 'transient' }],
      },
    ]);
    const { client, updates } = mockServiceClient({
      schedule: { ...scheduleRow, providers: ['youtube', 'instagram'], instagram_account_ids: ['ig-1'] },
    });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('published');
    const final = updates[1]?.patch as Record<string, unknown>;
    const outcomes = final.publish_outcomes as Array<Record<string, unknown>>;
    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]).toMatchObject({ provider: 'instagram', status: 'failed', code: 'transient', requiresUser: false });
  });

  it('returns 409 when the slot claim loses the race', async () => {
    const { client, updates } = mockServiceClient({ claimConflict: true });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('SLOT_NOT_AWAITING_APPROVAL');
    expect(updates).toHaveLength(1);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
    const claimedLedger = await mockClaimAsapLedger.mock.results[0]?.value;
    expect(mockReleaseAsapLedger).toHaveBeenCalledTimes(1);
    expect(mockReleaseAsapLedger).toHaveBeenCalledWith(claimedLedger, { code: 'PGRST116' });
  });

  it('returns 409 when no accounts are granted, without claiming the slot', async () => {
    mockHasGrantedAccounts.mockReturnValueOnce(false);
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(409);
    expect(updates).toHaveLength(0);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
    const claimedLedger = await mockClaimAsapLedger.mock.results[0]?.value;
    expect(mockReleaseAsapLedger).toHaveBeenCalledTimes(1);
    expect(mockReleaseAsapLedger).toHaveBeenCalledWith(claimedLedger, expect.any(Error));
    expect((mockReleaseAsapLedger.mock.calls[0]?.[1] as Error).message).toBe(
      'The accounts for this post are busy with another publish.',
    );
  });

  it('returns 409 when the upload extension fails, without claiming the slot', async () => {
    mockUpdateUpload.mockResolvedValueOnce(false);
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_CONSUMED');
    expect(updates).toHaveLength(0);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('reverts the slot to awaiting_approval when the publish media claim fails', async () => {
    mockPublishHeldMedia.mockRejectedValueOnce(new VideoUploadError('This video upload has expired. Mint a new one.', 410, 'VIDEO_UPLOAD_EXPIRED'));
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(410);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_EXPIRED');
    expect(updates).toHaveLength(2);
    expect((updates[1]?.patch as Record<string, unknown>).status).toBe('awaiting_approval');
    const claimedLedger = await mockClaimAsapLedger.mock.results[0]?.value;
    expect(mockReleaseAsapLedger).toHaveBeenCalledTimes(1);
    expect(mockReleaseAsapLedger).toHaveBeenCalledWith(
      claimedLedger,
      expect.objectContaining({ code: 'VIDEO_UPLOAD_EXPIRED' }),
    );
  });

  it('keeps a partial publish instead of reverting when a later provider throws', async () => {
    mockPublishHeldMedia.mockRejectedValueOnce(
      new PartialPublishError(
        [
          {
            provider: 'youtube',
            success: true,
            results: [{ accountId: 'UC1', success: true, videoId: 'vid-1', videoUrl: 'https://youtube.com/watch?v=vid-1' }],
          },
        ],
        new Error('settle failed'),
      ),
    );
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; status: string; publishes: unknown[] };
    expect(body.success).toBe(true);
    expect(body.status).toBe('published');
    expect(body.publishes).toHaveLength(1);
    expect(updates).toHaveLength(2);
    const final = updates[1]?.patch as Record<string, unknown>;
    expect(final.status).toBe('published');
    expect(final.published_at).toEqual(expect.any(String));
    const outcomes = final.publish_outcomes as Array<Record<string, unknown>>;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      provider: 'youtube',
      accountId: 'UC1',
      status: 'published',
      code: null,
      requiresUser: false,
      videoUrl: 'https://youtube.com/watch?v=vid-1',
    });
    expect(mockReleaseAsapLedger).toHaveBeenCalledTimes(1);
  });

  it('reverts the slot when the partial publish published nothing', async () => {
    mockPublishHeldMedia.mockRejectedValueOnce(new PartialPublishError([], new Error('form failed')));
    const { client, updates } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(500);
    expect(updates).toHaveLength(2);
    expect((updates[1]?.patch as Record<string, unknown>).status).toBe('awaiting_approval');
    expect(mockReleaseAsapLedger).toHaveBeenCalledTimes(1);
  });

  it('downloads a held image and publishes it with the stored bytes', async () => {
    const { client, storageDownload } = mockServiceClient();
    const imageSlot: HeldSlot = { ...awaitingSlot, media_kind: 'image', media_ref: 'scheduled-media/user-1/img.jpg', media_content_type: 'image/jpeg' };

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: imageSlot, route: ROUTE });

    expect(response.status).toBe(200);
    expect(storageDownload).toHaveBeenCalledWith('scheduled-media/user-1/img.jpg');
    expect(mockUpdateUpload).not.toHaveBeenCalled();
    const heldCtx = mockPublishHeldMedia.mock.calls[0]?.[0] as { uploadRow?: unknown; image?: { contentType?: string } } | undefined;
    expect(heldCtx?.uploadRow).toBeNull();
    expect(heldCtx?.image?.contentType).toBe('image/jpeg');
  });

  it('returns 404 when the schedule is gone', async () => {
    const { client } = mockServiceClient({ schedule: null });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(404);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 500 when the publish schedule lookup fails', async () => {
    const { client } = mockServiceClient({ scheduleError: { message: 'connection reset' } });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(500);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 404 when the held upload is gone', async () => {
    mockGetUpload.mockResolvedValueOnce(null);
    const { client } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_NOT_FOUND');
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 400 when the held slot has no media', async () => {
    const { client } = mockServiceClient();
    const noMediaSlot: HeldSlot = { ...awaitingSlot, media_kind: null, media_ref: null };

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: noMediaSlot, route: ROUTE });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_NOT_FOUND');
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 500 when the held image has an unknown content type', async () => {
    const { client } = mockServiceClient();
    const badImageSlot: HeldSlot = { ...awaitingSlot, media_kind: 'image', media_ref: 'scheduled-media/user-1/img.gif', media_content_type: 'image/gif' };

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: badImageSlot, route: ROUTE });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('MEDIA_CONTENT_TYPE_UNKNOWN');
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 400 when the held image download fails', async () => {
    const { client } = mockServiceClient({ download: { data: null, error: { message: 'gone' } } });
    const imageSlot: HeldSlot = { ...awaitingSlot, media_kind: 'image', media_ref: 'scheduled-media/user-1/img.jpg', media_content_type: 'image/jpeg' };

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: imageSlot, route: ROUTE });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_FILE_MISSING');
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 500 when the schedule has no providers', async () => {
    const { client } = mockServiceClient({ schedule: { ...scheduleRow, providers: [] } });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(500);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 500 when the persona lookup fails', async () => {
    const { client } = mockServiceClient({ personaError: { message: 'db down' } });

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(500);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });

  it('answers 500 when the ledger claim throws', async () => {
    mockClaimAsapLedger.mockRejectedValueOnce(new Error('redis down'));
    const { client } = mockServiceClient();

    const response = await publishHeldSlot({ request: request(), serviceClient: client as never, userId: USER_ID, slot: awaitingSlot, route: ROUTE });

    expect(response.status).toBe(500);
    expect(mockPublishHeldMedia).not.toHaveBeenCalled();
  });
});
