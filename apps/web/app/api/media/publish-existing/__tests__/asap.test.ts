// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuildExistingMediaForm = vi.hoisted(() =>
  vi.fn((provider: string) => {
    if (provider === 'instagram') throw new Error('form failed');
    return new FormData();
  }),
);
vi.mock('@/app/api/media/publish-existing/publish-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/media/publish-existing/publish-form')>();
  return { ...actual, buildExistingMediaForm: mockBuildExistingMediaForm };
});

const mockDispatchPublish = vi.hoisted(() =>
  vi.fn(async (provider: string) => ({
    provider,
    success: true,
    results: [{ accountId: provider === 'youtube' ? 'UC1' : 'ig-1', success: true, videoId: 'vid-1' }],
  })),
);
vi.mock('@/lib/videos/publish-uploaded', () => ({
  dispatchPublish: mockDispatchPublish,
}));

import { PartialPublishError, publishHeldMedia } from '../asap';
import type { PublishExistingContext } from '../context';
import type { Provider } from '../providers-validation';

function imageCtx(): PublishExistingContext {
  const accountIds = {
    youtube: ['UC1'],
    instagram: ['ig-1'],
    bluesky: [],
    linkedin: [],
    threads: [],
    facebook: [],
    pinterest: [],
    '3speak': [],
    rumble: [],
    fanvue: [],
    telegram: [],
  } satisfies Record<Provider, string[]>;
  return {
    aiLabel: false,
    approvalMode: 'approval',
    route: 'POST /api/media/publish-existing',
    supabase: {} as never,
    userId: 'user-1',
    request: new Request('https://example.com/api/media/publish-existing', { method: 'POST' }),
    input: {
      media: { kind: 'image', imageData: '', contentType: 'image/jpeg' },
      title: 'Held image',
      description: 'Edited outside.',
      personaId: null,
      publishing: {
        mode: 'asap',
        providers: ['youtube', 'instagram'],
        accounts: undefined,
        schedule: undefined,
        pinterestBoardId: null,
      },
      tags: undefined,
      privacyStatus: undefined,
      caption: undefined,
      promptVersionId: undefined,
      idempotencyKey: undefined,
    },
    accountIds,
    reconnectWarning: null,
    uploadRow: null,
    image: { buffer: Buffer.from([9]), contentType: 'image/jpeg' },
    logId: 'log-1',
    startTime: Date.now(),
  };
}

describe('publishHeldMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a PartialPublishError carrying the providers that already published', async () => {
    const error = await publishHeldMedia(imageCtx(), null).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PartialPublishError);
    const partial = error as PartialPublishError;
    expect(partial.publishes).toHaveLength(1);
    expect(partial.publishes[0]?.provider).toBe('youtube');
    expect(partial.publishes[0]?.results[0]).toMatchObject({ accountId: 'UC1', success: true });
    expect(partial.message).toBe('form failed');
    expect(mockDispatchPublish).toHaveBeenCalledTimes(1);
  });

  it('returns every provider publish when none throws', async () => {
    mockBuildExistingMediaForm.mockImplementation(() => new FormData());

    const publishes = await publishHeldMedia(imageCtx(), null);

    expect(publishes).toHaveLength(2);
    expect(publishes.map((publish) => publish.provider)).toEqual(['youtube', 'instagram']);
  });
});
