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
const PDS_HOST = 'pds.example.host.bsky.network';
const DID_DOC = {
  service: [
    {
      id: '#atproto_pds',
      type: 'AtprotoPersonalDataServer',
      serviceEndpoint: `https://${PDS_HOST}`,
    },
  ],
};

type SavedCall = { url: string; method?: string; headers?: HeadersInit; body?: unknown };
const savedCalls: SavedCall[] = [];

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

function mockSession(overrides: Record<string, unknown> = {}) {
  mockBlueskyLogin.mockResolvedValue({
    success: true,
    data: {
      did: DID,
      handle: 'eu.bsky.social',
      accessJwt: 'jwt-1',
      emailConfirmed: true,
      didDoc: DID_DOC,
      ...overrides,
    },
  });
}

function responseFor(url: string): Response {
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
}

function mockHappyFetch() {
  mockSession();
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    savedCalls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    return responseFor(url);
  });
}

describe('handleBlueskyUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedCalls.length = 0;
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
    // marked last_used_at
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), USER_ID, 'bluesky', DID);

    const body = (res as { results?: Array<{ success: boolean; postId?: string; error?: string }> }).results ?? [];
    expect(body[0]?.error ?? '(none)', 'first result should not fail').toBe('(none)');
    expect(body[0]?.success).toBe(true);
    expect(body[0]?.postId).toBe(`at://${DID}/app.bsky.feed.post/post-1`);

    const auth = savedCalls.find((call) => call.url.includes('getServiceAuth'));
    expect(auth).toBeDefined();
    const authUrl = new URL(auth!.url);
    expect(authUrl.searchParams.get('aud')).toBe(`did:web:${PDS_HOST}`);
    expect(authUrl.searchParams.get('lxm')).toBe('com.atproto.repo.uploadBlob');

    const posted = savedCalls.find((call) => call.url.includes('createRecord'));
    expect(posted).toBeDefined();
    expect(posted!.url).toBe('https://bsky.social/xrpc/com.atproto.repo.createRecord');
    expect(posted!.url.includes('repo=')).toBe(false);
    expect(posted!.url.includes('collection=')).toBe(false);
    const recordBody = JSON.parse(String(posted!.body)) as {
      repo: string;
      collection: string;
      record: { $type: string; text: string; createdAt: string; langs: string[]; embed: { video: unknown } };
    };
    expect(recordBody).toEqual({
      repo: DID,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'meu vídeo',
        createdAt: recordBody.record.createdAt,
        langs: ['pt'],
        embed: { $type: 'app.bsky.embed.video', video: { $link: 'bafk-video' } },
      },
    });
    const headers = posted!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer jwt-1');
  });

  it('getServiceAuth uses the PDS host as aud, never video.bsky.app', async () => {
    mockHappyFetch();
    await handleBlueskyUpload(formData(), USER_ID);
    const auth = savedCalls.find((call) => call.url.includes('getServiceAuth'));
    expect(auth).toBeDefined();
    expect(new URL(auth!.url).searchParams.get('aud')).toBe(`did:web:${PDS_HOST}`);
    expect(auth!.url.includes('video.bsky.app')).toBe(false);
  });

  it('uploadVideo 401 includes the error name and the account id, never the jwt or app password', async () => {
    mockSession();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      savedCalls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
      if (url.includes('uploadVideo')) {
        return new Response(JSON.stringify({ error: 'InvalidToken' }), { status: 401 });
      }
      return responseFor(url);
    });
    const res = await handleBlueskyUpload(formData(), USER_ID);
    const result = res.results[0];
    expect(result?.success).toBe(false);
    expect(result?.accountId).toBe(DID);
    expect(result?.error).toContain('InvalidToken');
    expect(result?.error).not.toContain('jwt-1');
    expect(result?.error).not.toContain('app-pass-1');
  });

  it('uploadVideo 401 without an error name reports only the status, never the jwt or app password', async () => {
    mockSession();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      savedCalls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
      if (url.includes('uploadVideo')) {
        return new Response(JSON.stringify({}), { status: 401 });
      }
      return responseFor(url);
    });
    const res = await handleBlueskyUpload(formData(), USER_ID);
    const result = res.results[0];
    expect(result?.success).toBe(false);
    expect(result?.accountId).toBe(DID);
    expect(result?.error).toBe('Bluesky video upload failed (401)');
    expect(result?.error).not.toContain('jwt-1');
    expect(result?.error).not.toContain('app-pass-1');
  });

  it('unverified email fails before any video.bsky.app request', async () => {
    mockSession({ emailConfirmed: false });
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      savedCalls.push({ url: String(input), method: init?.method, headers: init?.headers, body: init?.body });
      return responseFor(String(input));
    });
    const res = await handleBlueskyUpload(formData(), USER_ID);
    expect(res.results[0]?.success).toBe(false);
    expect(res.results[0]?.error?.toLowerCase()).toContain('email');
    expect(savedCalls.some((call) => call.url.includes('video.bsky.app'))).toBe(false);
  });

  it('a session without a PDS fails without calling getServiceAuth', async () => {
    mockSession({ didDoc: { service: [] } });
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      savedCalls.push({ url: String(input), method: init?.method, headers: init?.headers, body: init?.body });
      return responseFor(String(input));
    });
    const res = await handleBlueskyUpload(formData(), USER_ID);
    expect(res.results[0]?.success).toBe(false);
    expect(savedCalls.some((call) => call.url.includes('getServiceAuth'))).toBe(false);
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
