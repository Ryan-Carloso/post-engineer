// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/account-needs-reconnect', () => ({ markAccountNeedsReconnect: vi.fn(async () => undefined) }));

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })),
}));

import { trackApiEvent } from '@/lib/analytics';
import { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { markAccountNeedsReconnect } from '@/lib/account-needs-reconnect';

const USER_ID = 'user-uuid-1';
const MEMBER_ID = 'member-123';
const ORG_URN = 'urn:li:organization:111';

function makeFile(sizeBytes = 1000): File {
  return new File([new Uint8Array(sizeBytes)], 'clip.mp4', { type: 'video/mp4' });
}

function formData(overrides: Record<string, string | File | string[]> = {}): FormData {
  const fd = new FormData();
  const merged: Record<string, unknown> = {
    video: makeFile(),
    caption: 'meu post no linkedin',
    linkedinAccountIds: [MEMBER_ID],
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

function mockMemberTokens() {
  vi.mocked(getSocialAccountTokens).mockResolvedValue({
    tokens: {
      access_token: 'at-1',
      member_urn: `urn:li:person:${MEMBER_ID}`,
      expiry_date: Date.now() + 86_400_000,
    },
    account: {} as never,
  });
}

function mockOrgTokens() {
  vi.mocked(getSocialAccountTokens).mockResolvedValue({
    tokens: {
      access_token: 'at-1',
      member_urn: `urn:li:person:${MEMBER_ID}`,
      expiry_date: Date.now() + 86_400_000,
    },
    account: {} as never,
  });
}

function mockHappyFetch() {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/rest/images?action=initializeUpload')) {
      return new Response(JSON.stringify({
        value: { uploadUrl: 'https://upload.li/image1', image: 'urn:li:image:I1' },
      }), { status: 200 });
    }
    if (url.includes('initializeUpload')) {
      return new Response(JSON.stringify({
        value: {
          video: 'urn:li:video:V1',
          uploadToken: 'ut-1',
          uploadInstructions: [{ uploadUrl: 'https://upload.li/part1', firstByte: 0, lastByte: 999, partNumber: 0 }],
        },
      }), { status: 200 });
    }
    if (url.startsWith('https://upload.li/')) {
      return new Response(null, { status: 201 });
    }
    if (url.includes('finalizeUpload')) {
      return new Response(null, { status: 200 });
    }
    if (url.includes('/rest/posts') && method === 'POST') {
      return new Response(JSON.stringify({ id: 'urn:li:share:789' }), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  });
}

describe('handleLinkedinUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('returns failure without linkedinAccountIds', async () => {
    const res = await handleLinkedinUpload(formData({ linkedinAccountIds: [] }), USER_ID);
    expect(res.success).toBe(false);
  });

  it('returns failure without caption', async () => {
    const res = await handleLinkedinUpload(formData({ caption: '' }), USER_ID);
    expect(res.success).toBe(false);
  });

  it('expired token becomes a per-account failure with no network call', async () => {
    mockHappyFetch();
    vi.mocked(getSocialAccountTokens).mockResolvedValue({
      tokens: { access_token: 'at-1', expiry_date: Date.now() - 1000 },
      account: {} as never,
    });
    const res = await handleLinkedinUpload(formData(), USER_ID);
    const results = (res as { results: Array<{ success: boolean; error?: string }> }).results;
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('expired');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('publishes to the profile: author=person, full video flow', async () => {
    mockMemberTokens();
    mockHappyFetch();
    const res = await handleLinkedinUpload(formData(), USER_ID);

    expect(res.success).toBe(true);
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), USER_ID, 'linkedin', MEMBER_ID);

    const postCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/rest/posts'));
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.author).toBe(`urn:li:person:${MEMBER_ID}`);
    expect(body.commentary).toBe('meu post no linkedin');

    const results = (res as { results: Array<{ success: boolean; postId?: string }> }).results;
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.postId).toBe('urn:li:share:789');
  });

  it('publishes an image through the Images API: one PUT, the image URN as the post media, no video calls', async () => {
    mockMemberTokens();
    mockHappyFetch();
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'photo.jpg', { type: 'image/jpeg' });
    const res = await handleLinkedinUpload(formData({ video: jpeg }), USER_ID);

    expect(res.success).toBe(true);
    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/rest/videos'))).toBe(false);
    const init = mockFetch.mock.calls.find(([url]) => String(url).includes('/rest/images?action=initializeUpload'));
    expect(JSON.parse((init?.[1] as RequestInit).body as string)).toEqual({ initializeUploadRequest: { owner: `urn:li:person:${MEMBER_ID}` } });
    const put = mockFetch.mock.calls.find(([url]) => String(url) === 'https://upload.li/image1');
    expect((put?.[1] as RequestInit).method).toBe('PUT');
    const postCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/rest/posts'));
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string).content).toEqual({ media: { id: 'urn:li:image:I1' } });
  });

  it('rejects an image over 8 MB before any network call', async () => {
    mockMemberTokens();
    mockHappyFetch();
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const res = await handleLinkedinUpload(formData({ video: new File([big], 'big.jpg', { type: 'image/jpeg' }) }), USER_ID);
    expect(res.success).toBe(false);
    expect(res.results[0].error).toContain('8 MB');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails the account when the image PUT is rejected', async () => {
    mockMemberTokens();
    mockHappyFetch();
    const happy = mockFetch.getMockImplementation();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === 'https://upload.li/image1' ? new Response(null, { status: 500 }) : happy!(input, init));
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'p.png', { type: 'image/png' });
    const res = await handleLinkedinUpload(formData({ video: png }), USER_ID);
    expect(res.success).toBe(false);
    expect(res.results[0].error).toContain('LINKEDIN_PART_FAILED: image status 500');
  });

  it('publishes to the organization: provider_account_id is the org URN', async () => {
    mockOrgTokens();
    mockHappyFetch();
    const res = await handleLinkedinUpload(formData({ linkedinAccountIds: [ORG_URN] }), USER_ID);

    expect(res.success).toBe(true);
    const postCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/rest/posts'));
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.author).toBe(ORG_URN);
  });

  it('emits publish_account_unauthorized when LinkedIn rejects the token with 401', async () => {
    mockMemberTokens();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('initializeUpload')) {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
      }
      return new Response('{}', { status: 404 });
    });
    const res = await handleLinkedinUpload(formData(), USER_ID);
    const results = (res as { results: Array<{ success: boolean; error?: string }> }).results;
    expect(results[0]?.success).toBe(false);
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'linkedin',
      account_id: MEMBER_ID,
      user_id: USER_ID,
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the LinkedIn failure is not a 401', async () => {
    mockMemberTokens();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('initializeUpload')) {
        return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      }
      return new Response('{}', { status: 404 });
    });
    await handleLinkedinUpload(formData(), USER_ID);
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('one account failing does not block the other', async () => {
    mockHappyFetch();
    vi.mocked(getSocialAccountTokens)
      .mockRejectedValueOnce(new Error('Social account not found'))
      .mockResolvedValueOnce({
        tokens: { access_token: 'at-1', member_urn: `urn:li:person:${MEMBER_ID}`, expiry_date: Date.now() + 86_400_000 },
        account: {} as never,
      });

    const res = await handleLinkedinUpload(formData({ linkedinAccountIds: ['member-desconhecido', MEMBER_ID] }), USER_ID);
    expect(res.success).toBe(true);
    const results = (res as { results: Array<{ success: boolean }> }).results;
    expect(results[0]?.success).toBe(false);
    expect(results[1]?.success).toBe(true);
  });

  it('flags a LinkedIn account whose stored token is empty, with no network call', async () => {
    mockHappyFetch();
    vi.mocked(getSocialAccountTokens).mockResolvedValue({
      tokens: { access_token: '' },
      account: {} as never,
    });
    const res = await handleLinkedinUpload(formData(), USER_ID);
    const results = (res as { results: Array<{ success: boolean; errorCode?: string }> }).results;
    expect(results[0]).toMatchObject({ success: false, errorCode: 'token_missing' });
    expect(markAccountNeedsReconnect).toHaveBeenCalledWith(USER_ID, 'linkedin', MEMBER_ID);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
