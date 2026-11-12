// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/upload/handlers', () => ({
  handleYoutubeUpload: vi.fn(),
  handleInstagramUpload: vi.fn(),
  handleBlueskyUpload: vi.fn(),
}));
vi.mock('@/lib/upload/facebook-handler', () => ({ handleFacebookUpload: vi.fn() }));
vi.mock('@/lib/upload/fanvue-handler', () => ({ handleFanvueUpload: vi.fn() }));
vi.mock('@/lib/upload/linkedin-handler', () => ({ handleLinkedinUpload: vi.fn() }));
vi.mock('@/lib/upload/pinterest-handler', () => ({ handlePinterestUpload: vi.fn() }));
vi.mock('@/lib/upload/rumble-handler', () => ({ handleRumbleUpload: vi.fn() }));
vi.mock('@/lib/upload/threads-handler', () => ({ handleThreadsUpload: vi.fn() }));
vi.mock('@/lib/upload/threespeak-handler', () => ({ handleThreespeakUpload: vi.fn() }));

import { ValidationError } from '@/lib/errors';
import { handleBlueskyUpload, handleInstagramUpload, handleYoutubeUpload } from '@/lib/upload/handlers';
import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { handleFanvueUpload } from '@/lib/upload/fanvue-handler';
import { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
import { handlePinterestUpload } from '@/lib/upload/pinterest-handler';
import { handleRumbleUpload } from '@/lib/upload/rumble-handler';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { buildPublishForm, parsePublishBody, publishUploadedVideo, type PublishUploadedInput } from '../publish-uploaded';
import type {
  VideoUploadRow,
  VideoUploadStatus,
  VideoUploadStorage,
  VideoUploadStore,
} from '../signed-upload';

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const USER = 'user-uuid-1';
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);

const HANDLER_BY_PROVIDER = {
  youtube: handleYoutubeUpload,
  instagram: handleInstagramUpload,
  bluesky: handleBlueskyUpload,
  linkedin: handleLinkedinUpload,
  threads: handleThreadsUpload,
  facebook: handleFacebookUpload,
  pinterest: handlePinterestUpload,
  fanvue: handleFanvueUpload,
  '3speak': handleThreespeakUpload,
  rumble: handleRumbleUpload,
} as const satisfies Record<SocialProvider, unknown>;

function readyFixture(options?: { removeRejects?: boolean }): { store: VideoUploadStore; storage: VideoUploadStorage } {
  const row: VideoUploadRow = {
    id: UPLOAD_ID,
    user_id: USER,
    storage_path: `${USER}/direct-uploads/x.mp4`,
    declared_content_type: 'video/mp4',
    detected_content_type: 'video/mp4',
    size_bytes: MP4.length,
    status: 'ready',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
    consumed_at: null,
  };
  const store: VideoUploadStore = {
    insertUpload: vi.fn(async (next) => next),
    getUpload: vi.fn(async () => ({ ...row })),
    updateUpload: vi.fn(async () => true),
    deleteUpload: vi.fn(async () => undefined),
    listExpired: vi.fn(async () => []),
  };
  const storage: VideoUploadStorage = {
    createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: 'unused' } })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array(MP4)]), error: null })),
    remove: vi.fn(async () => {
      if (options?.removeRejects) throw new Error('cleanup failed');
      return { error: null };
    }),
  };
  return { store, storage };
}

beforeEach(() => {
  for (const handler of Object.values(HANDLER_BY_PROVIDER)) {
    vi.mocked(handler).mockReset();
  }
});

describe('parsePublishBody', () => {
  it('accepts a complete youtube publish', () => {
    const input = parsePublishBody({
      uploadId: UPLOAD_ID,
      provider: 'youtube',
      accountIds: ['chan-1'],
      title: 'T',
      description: 'D',
      tags: ['a'],
      privacyStatus: 'public',
    });
    expect(input.provider).toBe('youtube');
    expect(input.accountIds).toEqual(['chan-1']);
  });

  it('rejects a non-uuid uploadId, unknown provider and empty accounts', () => {
    expect(() => parsePublishBody({ uploadId: '/etc/passwd', provider: 'youtube', accountIds: ['x'] })).toThrow(ValidationError);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'tiktok', accountIds: ['x'] })).toThrow(ValidationError);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: [], caption: 'c' })).toThrow(ValidationError);
  });

  it('enforces provider-specific required fields', () => {
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'youtube', accountIds: ['x'], title: 'T', description: 'D' })).toThrow(/tags/);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['x'] })).toThrow(/Caption/);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'pinterest', accountIds: ['x'], caption: 'c' })).toThrow(/boardId/);
    expect(
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'pinterest', accountIds: ['x'], caption: 'c', boardId: 'b1' }).boardId,
    ).toBe('b1');
  });

  it('rejects a non-object body, non-string fields and blank provider gaps', () => {
    expect(() => parsePublishBody(null)).toThrow(ValidationError);
    expect(() => parsePublishBody([])).toThrow(ValidationError);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 1,
        description: 'D',
        tags: ['a'],
        privacyStatus: 'public',
      }),
    ).toThrow(/title must be a string/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: 'D',
        tags: 'a',
        privacyStatus: 'public',
      }),
    ).toThrow(/tags/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: 'D',
        tags: [1],
        privacyStatus: 'public',
      }),
    ).toThrow(/tags/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        description: 'D',
        tags: ['a'],
        privacyStatus: 'public',
      }),
    ).toThrow(/title/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: '   ',
        description: 'D',
        tags: ['a'],
        privacyStatus: 'public',
      }),
    ).toThrow(/title/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        tags: ['a'],
        privacyStatus: 'public',
      }),
    ).toThrow(/description/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: '   ',
        tags: ['a'],
        privacyStatus: 'public',
      }),
    ).toThrow(/description/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: 'D',
        tags: [],
        privacyStatus: 'public',
      }),
    ).toThrow(/tags/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: 'D',
        tags: ['a'],
      }),
    ).toThrow(/privacy/);
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['x'],
        title: 'T',
        description: 'D',
        tags: ['a'],
        privacyStatus: 'friends',
      }),
    ).toThrow(/privacy/);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['x'], caption: '   ' })).toThrow(
      /Caption/,
    );
    expect(() =>
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'pinterest', accountIds: ['x'], boardId: '   ', caption: 'c' }),
    ).toThrow(/boardId/);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'pinterest', accountIds: ['x'], boardId: 'b' })).toThrow(
      /description or caption/,
    );
    expect(() =>
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'pinterest',
        accountIds: ['x'],
        boardId: 'b',
        description: '   ',
        caption: '   ',
      }),
    ).toThrow(/description or caption/);
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'rumble', accountIds: ['x'], description: 'D' })).toThrow(
      /title/,
    );
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'fanvue', accountIds: ['x'], title: 'T' })).toThrow(
      /description/,
    );
    expect(() => parsePublishBody({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['   '], caption: 'c' })).toThrow(
      /account/,
    );
    expect(
      parsePublishBody({
        uploadId: UPLOAD_ID,
        provider: 'pinterest',
        accountIds: ['  x  '],
        boardId: 'b',
        description: 'D',
      }).accountIds,
    ).toEqual(['x']);
    expect(
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'rumble', accountIds: ['x'], title: 'T', description: 'D' }).provider,
    ).toBe('rumble');
    expect(
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'fanvue', accountIds: ['x'], title: 'T', description: 'D' }).provider,
    ).toBe('fanvue');
    expect(
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['x'], caption: 'hello' }).caption,
    ).toBe('hello');
    expect(
      parsePublishBody({ uploadId: UPLOAD_ID, provider: 'bluesky', accountIds: ['did'], caption: 'hello' }).provider,
    ).toBe('bluesky');
  });
});

describe('buildPublishForm', () => {
  it('uses the instagram file field and ig account field', () => {
    const form = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hello' },
      MP4,
      'video/mp4',
    );
    expect(form.get('provider')).toBe('instagram');
    expect(form.get('caption')).toBe('hello');
    expect(form.getAll('igAccountIds')).toEqual(['ig-1']);
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('uses the youtube video field with tags and privacy status', () => {
    const form = buildPublishForm(
      {
        uploadId: UPLOAD_ID,
        provider: 'youtube',
        accountIds: ['chan-1'],
        title: 'T',
        description: 'D',
        tags: ['a', 'b'],
        privacyStatus: 'unlisted',
      },
      MP4,
      'video/mp4',
    );
    expect(form.get('tags')).toBe('a,b');
    expect(form.get('privacyStatus')).toBe('unlisted');
    expect(form.getAll('accountIds')).toEqual(['chan-1']);
  });

  it('fills the remaining provider fields and the mov extension', () => {
    const bareYoutube = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'youtube', accountIds: ['c1', 'c2'] },
      MP4,
      'video/mp4',
    );
    expect(bareYoutube.get('title')).toBe('');
    expect(bareYoutube.get('description')).toBe('');
    expect(bareYoutube.get('tags')).toBe('');
    expect(bareYoutube.get('privacyStatus')).toBe('');
    expect((bareYoutube.get('video') as File).name).toBe('upload.mp4');

    const instagram = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: [] },
      MP4,
      'video/quicktime',
    );
    expect(instagram.get('caption')).toBe('');
    expect((instagram.get('file') as File).name).toBe('upload.mov');

    const rumble = buildPublishForm(
      {
        uploadId: UPLOAD_ID,
        provider: 'rumble',
        accountIds: ['r1', 'r2'],
        title: '  Title  ',
        description: '  Desc  ',
      },
      MP4,
      'video/quicktime',
    );
    expect(rumble.get('title')).toBe('Title');
    expect(rumble.get('description')).toBe('Desc');
    expect(rumble.getAll('rumbleAccountIds')).toEqual(['r1', 'r2']);
    expect((rumble.get('video') as File).name).toBe('upload.mov');

    const fanvue = buildPublishForm({ uploadId: UPLOAD_ID, provider: 'fanvue', accountIds: ['f1'] }, MP4, 'video/mp4');
    expect(fanvue.get('title')).toBe('');
    expect(fanvue.get('description')).toBe('');
    expect(fanvue.getAll('fanvueAccountIds')).toEqual(['f1']);

    const pinterest = buildPublishForm(
      {
        uploadId: UPLOAD_ID,
        provider: 'pinterest',
        accountIds: ['p1'],
        title: '  Pin  ',
        description: '  Body  ',
        caption: 'cap',
        boardId: '  board  ',
      },
      MP4,
      'video/mp4',
    );
    expect(pinterest.get('title')).toBe('Pin');
    expect(pinterest.get('description')).toBe('Body');
    expect(pinterest.get('caption')).toBe('cap');
    expect(pinterest.get('boardId')).toBe('board');
    expect(pinterest.getAll('pinterestAccountIds')).toEqual(['p1']);

    const pinterestCaption = buildPublishForm(
      {
        uploadId: UPLOAD_ID,
        provider: 'pinterest',
        accountIds: ['p1'],
        description: '   ',
        caption: '  from caption  ',
        boardId: 'b',
      },
      MP4,
      'video/mp4',
    );
    expect(pinterestCaption.get('description')).toBe('from caption');
    expect(pinterestCaption.get('title')).toBe('');

    const bluesky = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'bluesky', accountIds: ['did:plc:1'], caption: '  hello  ' },
      MP4,
      'video/mp4',
    );
    expect(bluesky.get('caption')).toBe('hello');
    expect(bluesky.getAll('did')).toEqual(['did:plc:1']);

    const linkedin = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'linkedin', accountIds: ['li-1'], caption: 'c' },
      MP4,
      'video/mp4',
    );
    expect(linkedin.getAll('linkedinAccountIds')).toEqual(['li-1']);
    const threads = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'threads', accountIds: ['th-1'], caption: 'c' },
      MP4,
      'video/mp4',
    );
    expect(threads.getAll('threadsAccountIds')).toEqual(['th-1']);
    const facebook = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: 'facebook', accountIds: ['fb-1'], caption: 'c' },
      MP4,
      'video/mp4',
    );
    expect(facebook.getAll('facebookAccountIds')).toEqual(['fb-1']);
    const threespeak = buildPublishForm(
      { uploadId: UPLOAD_ID, provider: '3speak', accountIds: ['sp-1'] },
      MP4,
      'video/mp4',
    );
    expect(threespeak.get('caption')).toBe('');
    expect(threespeak.getAll('threespeakAccountIds')).toEqual(['sp-1']);

    const fallback = buildPublishForm(
      {
        uploadId: UPLOAD_ID,
        provider: 'missing' as PublishUploadedInput['provider'],
        accountIds: ['t1'],
        caption: 'c',
      },
      MP4,
      'video/mp4',
    );
    expect(fallback.getAll('accountIds')).toEqual(['t1']);
    expect(fallback.get('caption')).toBe('c');
  });
});

describe('publishUploadedVideo', () => {
  it('claims the ready upload exactly once through the conditional update', async () => {
    const claimStatuses: VideoUploadStatus[] = [];
    const updateUpload = async (
      _id: string,
      expectedStatus: VideoUploadStatus,
      _patch: Partial<VideoUploadRow>,
    ): Promise<boolean> => {
      claimStatuses.push(expectedStatus);
      return true;
    };
    const row: VideoUploadRow = {
      id: UPLOAD_ID,
      user_id: USER,
      storage_path: `${USER}/direct-uploads/x.mp4`,
      declared_content_type: 'video/mp4',
      detected_content_type: 'video/mp4',
      size_bytes: MP4.length,
      status: 'ready',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
      consumed_at: null,
    };
    const store: VideoUploadStore = {
      insertUpload: vi.fn(async (r) => r),
      getUpload: vi.fn(async () => ({ ...row })),
      updateUpload,
      deleteUpload: vi.fn(async () => undefined),
      listExpired: vi.fn(async () => []),
    };
    const storage: VideoUploadStorage = {
      createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: 'unused' } })),
      download: vi.fn(async () => ({ data: new Blob([new Uint8Array(MP4)]), error: null })),
      remove: vi.fn(async () => ({ error: null })),
    };
    // A valid publish input: the claim must run exactly once, through the
    // conditional (expected-status) update that makes it single-use.
    const result = await publishUploadedVideo(
      store,
      storage,
      USER,
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' },
      'log-1',
      Date.now(),
      new Date(),
    ).catch((error: unknown) => error);
    // The instagram handler runs against mocked-nothing services and may
    // fail downstream; what this test pins is the single claim.
    expect(claimStatuses).toEqual(['ready']);
    expect(result).toBeDefined();
    expect(storage.remove).toHaveBeenCalledWith([`${USER}/direct-uploads/x.mp4`]);
  });

  it('copies handler ids and still returns when storage cleanup fails', async () => {
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({
      success: true,
      logId: 'handler-log',
      results: [
        {
          accountId: 'ig-1',
          success: true,
          videoId: 'v',
          videoUrl: 'https://v.example/v',
          postId: 'p',
          mediaId: 'm',
          permalink: 'https://v.example/p',
          error: 'e',
        },
        {
          accountId: 'ig-2',
          success: false,
          videoId: 1,
          videoUrl: null,
          postId: false,
          mediaId: {},
          permalink: 0,
          error: 5,
        },
      ],
    } as never);
    const { store, storage } = readyFixture({ removeRejects: true });
    const result = await publishUploadedVideo(
      store,
      storage,
      USER,
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' },
      'log-caller',
      10,
      new Date(),
    );
    expect(result).toEqual({
      success: true,
      provider: 'instagram',
      logId: 'handler-log',
      results: [
        {
          accountId: 'ig-1',
          success: true,
          videoId: 'v',
          videoUrl: 'https://v.example/v',
          postId: 'p',
          mediaId: 'm',
          permalink: 'https://v.example/p',
          error: 'e',
        },
        { accountId: 'ig-2', success: false },
      ],
    });
    expect(storage.remove).toHaveBeenCalled();
  });

  it('rejects a malformed handler response and a malformed account result', async () => {
    const input = { uploadId: UPLOAD_ID, provider: 'instagram' as const, accountIds: ['ig-1'], caption: 'hi' };
    const publish = async (): Promise<unknown> => {
      const { store, storage } = readyFixture();
      return publishUploadedVideo(store, storage, USER, input, 'log-1', 1, new Date());
    };
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce(null as never);
    await expect(publish()).rejects.toThrow(/malformed response/);
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ results: 'no' } as never);
    await expect(publish()).rejects.toThrow(/malformed response/);
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ results: [null] } as never);
    await expect(publish()).rejects.toThrow(/malformed account/);
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ results: [{ accountId: 1, success: true }] } as never);
    await expect(publish()).rejects.toThrow(/malformed account/);
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ results: [{ accountId: 'a', success: 'yes' }] } as never);
    await expect(publish()).rejects.toThrow(/malformed account/);
  });

  it('treats a non-true success flag as failure and keeps the caller log id', async () => {
    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ success: false, results: [] } as never);
    const failedFixture = readyFixture();
    const failed = await publishUploadedVideo(
      failedFixture.store,
      failedFixture.storage,
      USER,
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' },
      'log-caller',
      1,
      new Date(),
    );
    expect(failed.success).toBe(false);
    expect(failed.logId).toBe('log-caller');
    expect(failed.results).toEqual([]);

    vi.mocked(handleInstagramUpload).mockResolvedValueOnce({ success: 'true', results: [], logId: 4 } as never);
    const { store, storage } = readyFixture();
    const untyped = await publishUploadedVideo(
      store,
      storage,
      USER,
      { uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' },
      'log-caller',
      1,
      new Date(),
    );
    expect(untyped.success).toBe(false);
    expect(untyped.logId).toBe('log-caller');
  });

  it('dispatches every provider through its own handler', async () => {
    const inputFields = {
      title: 'T',
      description: 'D',
      tags: ['t'],
      privacyStatus: 'public',
      caption: 'c',
      boardId: 'b',
    };
    for (const provider of SOCIAL_PROVIDERS) {
      vi.mocked(HANDLER_BY_PROVIDER[provider]).mockResolvedValueOnce({
        success: true,
        results: [{ accountId: 'a', success: true }],
      } as never);
      const { store, storage } = readyFixture();
      const result = await publishUploadedVideo(
        store,
        storage,
        USER,
        { uploadId: UPLOAD_ID, provider, accountIds: ['a'], ...inputFields },
        'log-1',
        1,
        new Date(),
      );
      expect(result.provider).toBe(provider);
      expect(result.success).toBe(true);
      expect(vi.mocked(HANDLER_BY_PROVIDER[provider])).toHaveBeenCalledTimes(1);
    }
  });
});
