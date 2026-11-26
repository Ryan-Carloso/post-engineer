import { describe, expect, it } from 'vitest';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';
import type { ParsedPersonaForm } from '@/lib/persona-schema';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { buildPersonaInsertRow } from '../create-row';

function values(overrides: Partial<ParsedPersonaForm['values']> = {}): ParsedPersonaForm['values'] {
  return {
    name: '  Maria  ',
    identityCard: null,
    publishingAccounts: emptyPersonaDefaultAccounts(),
    ...overrides,
  };
}

const base = { personaId: 'p1', userId: 'u1', photoPath: 'u1/p1/photo.png' };

describe('buildPersonaInsertRow', () => {
  it('builds the insert row with the identifiers, the trimmed name, the photo and the card only', () => {
    const row = buildPersonaInsertRow({ ...base, values: values() });
    expect(row).toEqual({
      id: 'p1',
      user_id: 'u1',
      name: 'Maria',
      photo_path: 'u1/p1/photo.png',
      identity_card: null,
    });
  });

  it('stores null when the persona has no card', () => {
    expect(buildPersonaInsertRow({ ...base, values: values() }).identity_card).toBeNull();
  });

  it('stores the card when one is given', () => {
    expect(buildPersonaInsertRow({ ...base, values: values({ identityCard: FIXTURE_CARD }) }).identity_card).toEqual(FIXTURE_CARD);
  });
});
