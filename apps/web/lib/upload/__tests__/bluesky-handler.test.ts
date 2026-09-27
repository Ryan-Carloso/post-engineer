// @vitest-environment node
// The API handler uses native fetch/undici (upload to video.bsky.app).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

const mockBlueskyLogin = vi.hoisted(() => vi.fn());

vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    login = mockBlueskyLogin;
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })),
}));

vi.mock('@/lib/bluesky', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bluesky')>();
  return {
    ...actual,
    validateVideoForBluesky: vi.fn(actual.validateVideoForBluesky),
    truncateBlueskyCaption: vi.fn(actual.truncateBlueskyCaption),
  };
});

import { handleBlueskyUpload } from '@/lib/upload/bluesky-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';

const USER_ID = 'user-uuid-1';
const DID = 'did:plc:abc';

function makeFile(sizeBytes: number, type = 'video/mp4'): File {
  return new File([new Uint8Array(sizeBytes)], 'clip.mp4', { type });
}

function formData(overrides: Record<string, string | File | string[]> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, unknown> = {
    video: makeFile(1000),
    caption: 'meu vídeo',
    did: DID,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      for (const item of value) fd.append(key, item);
    } else {
      fd.append(key, value as string | Blob);
    }
  }
  return fd;
}

// fetch mock: createSession → getServiceAuth → uploadVideo → getJobStatus → createRecord
function mockHappyFetch() {
  mockBlueskyLogin.mockResolvedValue({ success: true, data: { did: DID, handle: 'eu.bsky.social', accessJwt: 'jwt-1' } });
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('createSession')) {
      return new Response(JSON.stringify({ accessJwt: 'jwt-1', did: DID }), { status: 200 });
    }
    if (url.includes('getServiceAuth')) {
      return new Response(JSON.stringify({ token: 'service-token-1' }), { status: 200 });
    }
    if (url.includes('uploadVideo')) {
      return new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 });
    }
    if (url.includes('getJobStatus')) {
      return new Response(
        JSON.stringify({ jobStatus: { jobId: 'job-1', state: 'JOB_STATE_COMPLETED', blob: { $link: 'bafk-video' } } }),
        { status: 200 },
      );
    }
    if (url.includes('createRecord')) {
      return new Response(JSON.stringify({ uri: `at://${DID}/app.bsky.feed.post/post-1` }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
}

describe('handleBlueskyUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.mocked(getSocialAccountTokens).mockResolvedValue({
      tokens: { access_token: 'app-pass-1', handle: 'eu.bsky.social', did: DID },
      account: {} as never,
    });
  });

  it('returns 400 without did', async () => {
    const res = await handleBlueskyUpload(formData({ did: [] }), USER_ID);
    expect(res.success).toBe(false);
  });

  it('returns 400 without caption', async () => {
    const res = await handleBlueskyUpload(formData({ caption: '' }), USER_ID);
    expect(res.success).toBe(false);
  });

  it('rejects videos above 100MB before touching any network', async () => {
    mockHappyFetch();
    const res = await handleBlueskyUpload(formData({ video: makeFile(100_000_001) }), USER_ID);
    expect(res.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publishes: fetches owner tokens, uploads video, waits for processing and posts', async () => {
    mockHappyFetch();
    const res = await handleBlueskyUpload(formData(), USER_ID);

    expect(res.success).toBe(true);
    // fetched the app password for the right account, of the right user
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), USER_ID, 'bluesky', DID);
    // marcou last_used_at
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), USER_ID, 'bluesky', DID);

    const body = (res as { results?: Array<{ success: boolean; postId?: string; error?: string }> }).results ?? [];
    expect(body[0]?.error ?? '(none)', 'first result should not fail').toBe('(none)');
    expect(body[0]?.success).toBe(true);
    expect(body[0]?.postId).toBe(`at://${DID}/app.bsky.feed.post/post-1`);
  });

  it('missing credential in the database becomes a per-account failure, not a 500', async () => {
    mockHappyFetch();
    vi.mocked(getSocialAccountTokens).mockRejectedValueOnce(new Error('Social account not found for bluesky/did:plc:abc'));

    const res = await handleBlueskyUpload(formData({ did: [DID, 'did:plc:other'] }), USER_ID);
    expect(res.success).toBe(true); // request ok; failure is per account
    const results = (res as { results?: Array<{ success: boolean; accountId: string }> }).results ?? [];
    expect(results[0]?.success).toBe(false);
    expect(results[1]?.success).toBe(true);
  });
});
