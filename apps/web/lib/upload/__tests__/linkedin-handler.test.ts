// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })),
}));

import { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';

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

// member tokens (no org URN) — personal account
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

// organization tokens (provider_account_id is already the org URN)
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

  it('publishes to the organization: provider_account_id is the org URN', async () => {
    mockOrgTokens();
    mockHappyFetch();
    const res = await handleLinkedinUpload(formData({ linkedinAccountIds: [ORG_URN] }), USER_ID);

    expect(res.success).toBe(true);
    const postCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/rest/posts'));
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.author).toBe(ORG_URN);
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
});
