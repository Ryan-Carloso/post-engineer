import { describe, it, expect } from 'vitest';

import { appendCreatePersonaFields, appendUpdatePersonaFields } from '../persona-form-fields.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';

describe('persona form fields', () => {
  it('create sends the name and the identity card only', () => {
    const form = new FormData();
    appendCreatePersonaFields(form, { name: 'Ava', accounts: { youtube: ['a'] }, identityCard: null });
    expect([...form.keys()].sort()).toEqual(['identityCard', 'name']);
    expect(form.get('identityCard')).toBe('null');
  });

  it('update sends nothing when no identity card is given', () => {
    const form = new FormData();
    appendUpdatePersonaFields(form, { personaId: 'p-1', name: 'Ava' });
    expect([...form.keys()]).toEqual([]);
  });

  it('create and update schemas drop generation-era fields', () => {
    const create = CreatePersonaSchema.safeParse({ name: 'Ava', accounts: { youtube: ['a'] }, voiceId: 'v', niche: 'x' });
    expect(create.success).toBe(true);
    if (create.success) expect(Object.keys(create.data).sort()).toEqual(['accounts', 'name']);
    const update = UpdatePersonaSchema.safeParse({ personaId: 'p-1', niche: 'x', faceQuality: 'ok' });
    expect(update.success).toBe(true);
    if (update.success) expect(Object.keys(update.data)).toEqual(['personaId']);
  });
});
