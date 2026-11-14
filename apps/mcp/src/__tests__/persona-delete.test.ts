import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { ApiError } from '../errors.js';
import { handlePersonaDelete } from '../persona-delete.js';
import type { McpToolResponse } from '../tools-call.js';

// personas · delete is preview then confirm in one action: the first call
// never deletes, the token proves the agent saw this exact preview, and a
// persona that changed since then needs a fresh preview.

function client(preview: { counts: Record<string, number>; videos?: Array<{ taskId: string; downloadUrl: string }> }) {
  const getPersonaDeletePreview = vi.fn(async () => ({ persona: { id: 'p1', name: 'Maria' }, counts: preview.counts, videos: preview.videos ?? [] }));
  const deletePersona = vi.fn(async () => ({ success: true }));
  return { client: { getPersonaDeletePreview, deletePersona } as unknown as PostEngineerClient, getPersonaDeletePreview, deletePersona };
}

const text = (response: McpToolResponse): string => (response.content[0].type === 'text' ? response.content[0].text : '');
const tokenOf = (response: McpToolResponse): string => /confirmToken "([0-9a-f]+)"/.exec(text(response))?.[1] ?? '';

describe('personas · delete', () => {
  it('without a token only previews: shows what would be removed, gives a token and deletes nothing', async () => {
    const { client: c, deletePersona } = client({ counts: { schedules: 2, personaImages: 3 } });
    const response = await handlePersonaDelete(c, { personaId: 'p1' });
    expect(response.isError).not.toBe(true);
    expect(text(response)).toContain('Preview only');
    expect(text(response)).toContain('2 schedule(s)');
    expect(tokenOf(response)).toMatch(/^[0-9a-f]{16}$/);
    expect(deletePersona).not.toHaveBeenCalled();
  });

  it('deletes with the token from that preview', async () => {
    const { client: c, deletePersona } = client({ counts: { schedules: 2 } });
    const token = tokenOf(await handlePersonaDelete(c, { personaId: 'p1' }));
    const response = await handlePersonaDelete(c, { personaId: 'p1', confirmToken: token });
    expect(response.isError).not.toBe(true);
    expect(deletePersona).toHaveBeenCalledWith('p1');
  });

  it('refuses a wrong token, deletes nothing and shows the preview again', async () => {
    const { client: c, deletePersona } = client({ counts: { schedules: 2 } });
    const response = await handlePersonaDelete(c, { personaId: 'p1', confirmToken: '0000000000000000' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('does not match');
    expect(tokenOf(response)).toMatch(/^[0-9a-f]{16}$/);
    expect(deletePersona).not.toHaveBeenCalled();
  });

  it('invalidates the token when the persona changed since the preview', async () => {
    const before = client({ counts: { schedules: 2 } });
    const token = tokenOf(await handlePersonaDelete(before.client, { personaId: 'p1' }));
    const after = client({ counts: { schedules: 3 } });
    const response = await handlePersonaDelete(after.client, { personaId: 'p1', confirmToken: token });
    expect(response.isError).toBe(true);
    expect(after.deletePersona).not.toHaveBeenCalled();
    expect(tokenOf(response)).not.toBe(token);
  });

  it('ignores the per-call download links, which change on every preview', async () => {
    const first = client({ counts: { schedules: 1 }, videos: [{ taskId: 't1', downloadUrl: 'https://x/sig=1' }] });
    const second = client({ counts: { schedules: 1 }, videos: [{ taskId: 't1', downloadUrl: 'https://x/sig=2' }] });
    const token = tokenOf(await handlePersonaDelete(first.client, { personaId: 'p1' }));
    await handlePersonaDelete(second.client, { personaId: 'p1', confirmToken: token });
    expect(second.deletePersona).toHaveBeenCalledWith('p1');
  });

  it('binds the token to the persona id', async () => {
    const { client: c, deletePersona } = client({ counts: { schedules: 1 } });
    const token = tokenOf(await handlePersonaDelete(c, { personaId: 'p1' }));
    const response = await handlePersonaDelete(c, { personaId: 'p2', confirmToken: token });
    expect(response.isError).toBe(true);
    expect(deletePersona).not.toHaveBeenCalled();
  });

  it('reports a failed preview as an error instead of deleting', async () => {
    const c = { getPersonaDeletePreview: vi.fn(async () => { throw new Error('boom'); }), deletePersona: vi.fn() } as unknown as PostEngineerClient;
    const response = await handlePersonaDelete(c, { personaId: 'p1', confirmToken: 'abc' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('boom');
  });

  it('keeps the structured API error contract when the preview fails with an ApiError', async () => {
    const c = {
      getPersonaDeletePreview: vi.fn(async () => { throw new ApiError('Failed to get delete preview: 404 Persona not found.', 'PERSONA_NOT_FOUND', 'personaId'); }),
      deletePersona: vi.fn(),
    } as unknown as PostEngineerClient;
    const response = await handlePersonaDelete(c, { personaId: 'nope' });
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('"code":"PERSONA_NOT_FOUND"');
    expect(text(response)).toContain('"field":"personaId"');
    expect(c.deletePersona).not.toHaveBeenCalled();
  });

  it('coerces a malformed preview envelope to nulls and still previews', async () => {
    const c = {
      getPersonaDeletePreview: vi.fn(async () => ({ persona: { id: 5 }, counts: { schedules: 'many' }, videos: [null], videosTruncated: 'yes' })),
      deletePersona: vi.fn(),
    } as unknown as PostEngineerClient;
    const response = await handlePersonaDelete(c, { personaId: 'persona-1' });
    expect(response.isError).not.toBe(true);
    expect(text(response)).toContain('Deleting persona "persona-1" would remove ? schedule(s)');
    expect(text(response)).toContain('"schedules": null');
    expect(text(response)).toContain('"taskId": null');
  });

  it('treats a missing envelope as all-null', async () => {
    const c = { getPersonaDeletePreview: vi.fn(async () => null), deletePersona: vi.fn() } as unknown as PostEngineerClient;
    const response = await handlePersonaDelete(c, { personaId: 'persona-1' });
    expect(response.isError).not.toBe(true);
    expect(text(response)).toContain('"videos": []');
  });

  it('narrows the counts and the per-video download links of the preview', async () => {
    const c = {
      getPersonaDeletePreview: vi.fn(async () => ({
        success: true,
        persona: { id: 'persona-1', name: 'Ava' },
        counts: { schedules: 2, upcomingSlots: 5, publishedSlots: 10, failedSlots: 1, generatedVideos: 12, personaImages: 4 },
        videos: [{ taskId: 'task-1', title: 'Gym', status: 'completed', downloadUrl: 'https://cdn.test/v1.mp4', extra: 'dropped' }],
        videosTruncated: false,
        linksIncomplete: false,
      })),
      deletePersona: vi.fn(),
    } as unknown as PostEngineerClient;
    const response = await handlePersonaDelete(c, { personaId: 'persona-1' });
    expect(text(response)).toContain('Deleting persona "Ava" would remove 2 schedule(s), 5 upcoming slot(s), 10 published slot(s), 12 generated video(s), and 4 library image(s).');
    expect(text(response)).toContain('"downloadUrl": "https://cdn.test/v1.mp4"');
    expect(text(response)).not.toContain('dropped');
  });
});
