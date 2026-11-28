import { describe, it, expect } from 'vitest';

import { parsePersonaForm } from '@/lib/persona-schema';
import { parseAiLabelFormValue } from '@/lib/ai-label-form';
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

describe('ai label form value', () => {
  it.each([
    ['true', true],
    ['false', false],
    [null, null],
  ])('parses %s as %s', (raw, expected) => {
    expect(parseAiLabelFormValue(raw)).toEqual({ ok: true, value: expected });
  });

  it('rejects anything else', () => {
    expect(parseAiLabelFormValue('yes')).toEqual({ ok: false });
  });
});

describe('persona create form aiLabel', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses aiLabel=%s and stores ai_label=%s', (raw, stored) => {
    const parsed = parsePersonaForm(form({ name: 'Ana', aiLabel: raw, publishingAccounts: ACCOUNTS }), 'create');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.values.aiLabel).toBe(stored);
    expect(personaPreferenceColumns(parsed.value.values).ai_label).toBe(stored);
  });

  it('stores ai_label=false when the form omits it', () => {
    const parsed = parsePersonaForm(form({ name: 'Ana', publishingAccounts: ACCOUNTS }), 'create');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.values.aiLabel).toBeNull();
    expect(personaPreferenceColumns(parsed.value.values).ai_label).toBe(false);
  });

  it('rejects an aiLabel that is not true or false', () => {
    expect(parsePersonaForm(form({ name: 'Ana', aiLabel: 'yes', publishingAccounts: ACCOUNTS }), 'create')).toEqual({
      ok: false,
      error: 'Invalid aiLabel: yes. Use true or false.',
    });
  });
});

describe('persona PATCH aiLabel', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('writes ai_label=%s', async (raw, stored) => {
    const parsed = await parsePatchBody(patchRequest({ aiLabel: raw }));
    if (!parsed.ok) throw new Error(parsed.error);
    const updates: Record<string, unknown> = {};
    expect(applyPersonaPatchFields(parsed.value, updates, {})).toBeNull();
    expect(updates).toEqual({ ai_label: stored });
  });

  it('leaves ai_label alone when the PATCH omits it', async () => {
    const parsed = await parsePatchBody(patchRequest({ niche: 'travel' }));
    if (!parsed.ok) throw new Error(parsed.error);
    const updates: Record<string, unknown> = {};
    applyPersonaPatchFields(parsed.value, updates, {});
    expect(updates).not.toHaveProperty('ai_label');
  });

  it('rejects an aiLabel that is not true or false', async () => {
    expect(await parsePatchBody(patchRequest({ aiLabel: '1' }))).toEqual({
      ok: false,
      error: 'Invalid aiLabel: 1. Use true or false.',
      logMessage: 'Invalid aiLabel. Use true or false.',
    });
  });
});
