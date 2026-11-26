import { describe, it, expect } from 'vitest';

import { appendCreatePersonaFields, appendUpdatePersonaFields } from '../persona-form-fields.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';

describe('persona form fields', () => {
  it('create sends the name, the AI label and the identity card only', () => {
    const form = new FormData();
    appendCreatePersonaFields(form, { name: 'Ava', accounts: { youtube: ['a'] }, identityCard: null });
    expect([...form.keys()].sort()).toEqual(['aiLabel', 'identityCard', 'name']);
    expect(form.get('aiLabel')).toBe('false');
    expect(form.get('identityCard')).toBe('null');
  });

  it('create sends an explicit AI label', () => {
    const form = new FormData();
    appendCreatePersonaFields(form, { name: 'Ava', accounts: {}, aiLabel: true });
    expect(form.get('aiLabel')).toBe('true');
  });

  it('update sends nothing when no identity card or AI label is given', () => {
    const form = new FormData();
    appendUpdatePersonaFields(form, { personaId: 'p-1', name: 'Ava' });
    expect([...form.keys()]).toEqual([]);
  });

  it('update sends an explicit AI label', () => {
    const form = new FormData();
    appendUpdatePersonaFields(form, { personaId: 'p-1', aiLabel: false });
    expect(form.get('aiLabel')).toBe('false');
  });

  it('create and update schemas drop generation-era fields and keep the AI label', () => {
    const create = CreatePersonaSchema.safeParse({ name: 'Ava', accounts: { youtube: ['a'] }, voiceId: 'v', niche: 'x', aiLabel: true });
    expect(create.success).toBe(true);
    if (create.success) expect(Object.keys(create.data).sort()).toEqual(['accounts', 'aiLabel', 'name']);
    const update = UpdatePersonaSchema.safeParse({ personaId: 'p-1', niche: 'x', faceQuality: 'ok' });
    expect(update.success).toBe(true);
    if (update.success) expect(Object.keys(update.data)).toEqual(['personaId']);
  });
});
