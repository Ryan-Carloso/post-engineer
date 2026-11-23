import { describe, it, expect, vi } from 'vitest';
import { createShareLink, listShareLinks, revokeShareLink } from '../client-share-links.js';
import {
  CreateShareLinkSchema,
  handleCreateShareLink,
  handleListShareLinks,
  handleRevokeShareLink,
} from '../tools-share-links.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

const HEADERS = { Authorization: 'Bearer test-token' };
const PERSONA = '0b7c2c55-4a3e-4c55-9d7e-1f2a3b4c5d6e';
const LINK_ID = '11111111-1111-4111-8111-111111111111';

function fakeClient(request: ReturnType<typeof vi.fn>): PostEngineerClient {
  return {
    request,
    getHeaders: vi.fn().mockReturnValue(HEADERS),
  } as unknown as PostEngineerClient;
}

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

const CREATED = {
  success: true,
  id: LINK_ID,
  token: 'a'.repeat(43),
  path: `/s/${'a'.repeat(43)}`,
  url: `https://post-engineer.com/s/${'a'.repeat(43)}`,
  personaIds: [PERSONA],
  createdAt: '2026-11-22T00:00:00.000Z',
  expiresAt: null,
};

describe('share link client', () => {
  it('posts the persona and the expiry to /api/share-links', async () => {
    const request = vi.fn().mockResolvedValue(CREATED);
    const result = await createShareLink(fakeClient(request), { personaId: PERSONA, expiresInDays: 7 });
    expect(request).toHaveBeenCalledWith(
      '/api/share-links',
      { method: 'POST', headers: HEADERS, body: JSON.stringify({ personaIds: [PERSONA], expiresInDays: 7 }) },
      'create share link',
    );
    expect(result.url).toBe(CREATED.url);
  });

  it('sends an empty body when neither a persona nor an expiry is given', async () => {
    const request = vi.fn().mockResolvedValue(CREATED);
    await createShareLink(fakeClient(request), {});
    expect(request.mock.calls[0]?.[1]).toMatchObject({ body: '{}' });
  });

  it('lists the links with GET /api/share-links', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, links: [] });
    await expect(listShareLinks(fakeClient(request))).resolves.toEqual({ success: true, links: [] });
    expect(request).toHaveBeenCalledWith('/api/share-links', { method: 'GET', headers: HEADERS }, 'list share links');
  });

  it('revokes with DELETE and encodes the id in the path', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, alreadyRevoked: false });
    await revokeShareLink(fakeClient(request), 'a/b');
    expect(request).toHaveBeenCalledWith(
      '/api/share-links/a%2Fb',
      { method: 'DELETE', headers: HEADERS },
      'revoke share link',
    );
  });

  it('rejects a malformed create response', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, id: LINK_ID });
    await expect(createShareLink(fakeClient(request), {})).rejects.toThrow(/Malformed response from POST \/api\/share-links/);
  });
});

describe('share link tool handlers', () => {
  it('returns the created link as JSON text', async () => {
    const request = vi.fn().mockResolvedValue(CREATED);
    const response = await handleCreateShareLink(fakeClient(request), CreateShareLinkSchema.parse({ expiresInDays: 3 }));
    expect(response.isError).toBeUndefined();
    expect(JSON.parse(textOf(response))).toMatchObject({ url: CREATED.url });
  });

  it('resolves a persona id to personaIds', async () => {
    const request = vi.fn().mockImplementation(async (path: string) =>
      path === '/api/persona/list' ? { success: true, personas: [{ id: PERSONA, name: 'Maria' }] } : CREATED,
    );
    await handleCreateShareLink(fakeClient(request), CreateShareLinkSchema.parse({ persona: PERSONA }));
    const post = request.mock.calls.find((call) => call[0] === '/api/share-links');
    expect(post?.[1]).toMatchObject({ body: JSON.stringify({ personaIds: [PERSONA] }) });
  });

  it('rejects an expiry beyond a year before any request', () => {
    expect(CreateShareLinkSchema.safeParse({ expiresInDays: 366 }).success).toBe(false);
  });

  it('reports a failed list as an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('boom'));
    const response = await handleListShareLinks(fakeClient(request));
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error listing share links');
  });

  it('reports a failed revoke as an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('boom'));
    const response = await handleRevokeShareLink(fakeClient(request), { id: LINK_ID });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error revoking share link');
  });
});
