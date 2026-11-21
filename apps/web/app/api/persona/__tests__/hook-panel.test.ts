// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { parsePersonaForm } from '@/lib/persona-schema';
import { parsePatchBody } from '../patch-body';
import { applyPersonaPatchFields } from '../patch-updates';
import { personaPreferenceColumns } from '../preference-columns';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function patchRequest(fields: Record<string, string>): Request {
  return new Request('http://localhost/api/persona?personaId=p-1', { method: 'PATCH', body: form(fields) });
}

const ACCOUNTS = JSON.stringify({ youtube: ['yt-1'] });

describe('persona create form hookPanel', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses hookPanel=%s and stores hook_panel=%s', (raw, stored) => {
    const parsed = parsePersonaForm(form({ name: 'Ana', hookPanel: raw, publishingAccounts: ACCOUNTS }), 'create');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.values.hookPanel).toBe(stored);
    expect(personaPreferenceColumns(parsed.value.values).hook_panel).toBe(stored);
  });

  it('stores hook_panel=true when the form omits it', () => {
    const parsed = parsePersonaForm(form({ name: 'Ana', publishingAccounts: ACCOUNTS }), 'create');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.values.hookPanel).toBeNull();
    expect(personaPreferenceColumns(parsed.value.values).hook_panel).toBe(true);
  });

  it('rejects a hookPanel that is not true or false', () => {
    expect(parsePersonaForm(form({ name: 'Ana', hookPanel: 'yes', publishingAccounts: ACCOUNTS }), 'create')).toEqual({
      ok: false,
      error: 'Invalid hookPanel: yes. Use true or false.',
    });
  });
});

describe('persona PATCH hookPanel', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('writes hook_panel=%s', async (raw, stored) => {
    const parsed = await parsePatchBody(patchRequest({ hookPanel: raw }));
    if (!parsed.ok) throw new Error(parsed.error);
    const updates: Record<string, unknown> = {};
    expect(applyPersonaPatchFields(parsed.value, updates, {})).toBeNull();
    expect(updates).toEqual({ hook_panel: stored });
  });

  it('leaves hook_panel alone when the PATCH omits it', async () => {
    const parsed = await parsePatchBody(patchRequest({ niche: 'travel' }));
    if (!parsed.ok) throw new Error(parsed.error);
    const updates: Record<string, unknown> = {};
    applyPersonaPatchFields(parsed.value, updates, {});
    expect(updates).not.toHaveProperty('hook_panel');
  });

  it('rejects a hookPanel that is not true or false', async () => {
    expect(await parsePatchBody(patchRequest({ hookPanel: '1' }))).toEqual({
      ok: false,
      error: 'Invalid hookPanel: 1. Use true or false.',
      logMessage: 'Invalid hookPanel. Use true or false.',
    });
  });
});
