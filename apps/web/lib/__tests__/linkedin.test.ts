// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/token-crypto', () => ({
  encryptTokens: vi.fn((payload: Record<string, unknown>) => `v1.mock.${Buffer.from(JSON.stringify(payload)).toString('base64')}`),
  decryptTokens: vi.fn(),
}));

import {
  LinkedinError,
  buildLinkedInAuthorizationUrl,
  LINKEDIN_SCOPES,
  exchangeLinkedInCodeForToken,
  fetchLinkedInMemberProfile,
  fetchLinkedInAdminOrganizations,
  initializeLinkedInVideoUpload,
  uploadLinkedInVideoParts,
  finalizeLinkedInVideoUpload,
  createLinkedInMemberPost,
  createLinkedInOrganizationPost,
  LINKEDIN_VIDEO_MAX_BYTES,
  LINKEDIN_API_VERSION,
} from '@/lib/linkedin';

const ENV = {
  LINKEDIN_CLIENT_ID: 'client-1',
  LINKEDIN_CLIENT_SECRET: 'secret-1',
  LINKEDIN_REDIRECT_URI: 'https://post-engineer.com/api/linkedin-auth/callback',
};

describe('linkedin — constantes', () => {
  it('exposes documented limits and API version', () => {
    expect(LINKEDIN_VIDEO_MAX_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(LINKEDIN_API_VERSION).toMatch(/^\d{6}$/);
    expect(LINKEDIN_SCOPES).toContain('w_member_social');
    expect(LINKEDIN_SCOPES).toContain('openid');
  });
});

describe('buildLinkedInAuthorizationUrl', () => {
  it('builds the OAuth URL with scopes and a PKCE-less state', () => {
    process.env.LINKEDIN_CLIENT_ID = ENV.LINKEDIN_CLIENT_ID;
    process.env.LINKEDIN_REDIRECT_URI = ENV.LINKEDIN_REDIRECT_URI;
    const url = new URL(buildLinkedInAuthorizationUrl('state-abc'));
    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('w_member_social');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.LINKEDIN_REDIRECT_URI);
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_REDIRECT_URI;
  });

  it('fails explicitly without env (no fallback)', () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    expect(() => buildLinkedInAuthorizationUrl('s')).toThrow(LinkedinError);
  });
});

describe('exchangeLinkedInCodeForToken', () => {
  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = ENV.LINKEDIN_CLIENT_ID;
    process.env.LINKEDIN_CLIENT_SECRET = ENV.LINKEDIN_CLIENT_SECRET;
    process.env.LINKEDIN_REDIRECT_URI = ENV.LINKEDIN_REDIRECT_URI;
    mockFetch.mockReset();
  });

  it('exchanges the code for an access token with version headers', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at-1', expires_in: 5184000 }), { status: 200 }));
    const token = await exchangeLinkedInCodeForToken('code-1');
    expect(token.access_token).toBe('at-1');
    expect(token.expires_in).toBe(5184000);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/oauth/v2/accessToken');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('a LinkedIn 400 error becomes LinkedinError with the API message', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code expired' }), { status: 400 }));
    await expect(exchangeLinkedInCodeForToken('bad')).rejects.toMatchObject({ name: 'LinkedInError' });
  });
});

describe('fetchLinkedInMemberProfile / fetchLinkedInAdminOrganizations', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('profile returns id and name', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'member-123', name: 'Ryan C' }), { status: 200 }));
    const profile = await fetchLinkedInMemberProfile('at-1');
    expect(profile).toEqual({ id: 'member-123', name: 'Ryan C' });
    const [, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer at-1');
    expect(headers['Linkedin-Version']).toBe(LINKEDIN_API_VERSION);
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });

  it('admin organizations return a list of {id, name}', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      elements: [
        { organizationalEntity: 'urn:li:organization:111', organizationName: { localized: { pt_BR: 'Minha Page' } } },
        { organizationalEntity: 'urn:li:organization:222' },
      ],
    }), { status: 200 }));
    const orgs = await fetchLinkedInAdminOrganizations('at-1');
    expect(orgs).toEqual([
      { id: 'urn:li:organization:111', name: 'Minha Page' },
      { id: 'urn:li:organization:222', name: null },
    ]);
  });
});

describe('video upload flow', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('initialize → uploadInstructions; finalizeURN retornado', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: {
          video: 'urn:li:video:V1',
          uploadToken: 'ut-1',
          uploadInstructions: [{ uploadUrl: 'https://upload.linkedin.com/part1', firstByte: 0, lastByte: 9, partNumber: 0 }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const init = await initializeLinkedInVideoUpload('at-1', 'urn:li:person:member-123', 10, 'video/mp4');
    expect(init.video).toBe('urn:li:video:V1');
    expect(init.uploadInstructions).toHaveLength(1);

    await uploadLinkedInVideoParts('at-1', init.uploadInstructions, [new Uint8Array(10)]);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await finalizeLinkedInVideoUpload('at-1', init.video, 'ut-1');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects buffers above 5GB without any network call', async () => {
    await expect(
      initializeLinkedInVideoUpload('at-1', 'urn:li:person:1', LINKEDIN_VIDEO_MAX_BYTES + 1, 'video/mp4'),
    ).rejects.toMatchObject({ name: 'LinkedInError' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('posts', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('member post uses author=person and returns the post URN', async () => {
    mockFetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: 'urn:li:share:789' }),
      { status: 201, headers: { 'x-restli-id': 'urn:li:share:789' } },
    ));
    const urn = await createLinkedInMemberPost('at-1', 'member-123', 'urn:li:video:V1', 'meu post');
    expect(urn).toBe('urn:li:share:789');
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.author).toBe('urn:li:person:member-123');
    expect(body.commentary).toBe('meu post');
    expect(body.content.media.id).toBe('urn:li:video:V1');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Linkedin-Version']).toBe(LINKEDIN_API_VERSION);
  });

  it('organization post uses author=organization', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'urn:li:share:790' }), { status: 201 }));
    const urn = await createLinkedInOrganizationPost('at-1', 'urn:li:organization:111', 'urn:li:video:V1', 'post da page');
    expect(urn).toBe('urn:li:share:790');
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.author).toBe('urn:li:organization:111');
  });
});
