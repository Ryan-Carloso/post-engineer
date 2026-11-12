// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '@/lib/errors';
import { buildPublishForm, parsePublishBody, publishUploadedVideo } from '../publish-uploaded';
import type {
  VideoUploadRow,
  VideoUploadStatus,
  VideoUploadStorage,
  VideoUploadStore,
} from '../signed-upload';

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const USER = 'user-uuid-1';
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);

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
  });
});
