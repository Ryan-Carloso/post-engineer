import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
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
});
