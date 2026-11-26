import { describe, expect, it } from 'vitest';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';
import type { ParsedPersonaForm } from '@/lib/persona-schema';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { buildPersonaInsertRow } from '../create-row';

function values(overrides: Partial<ParsedPersonaForm['values']> = {}): ParsedPersonaForm['values'] {
  return {
    name: '  Maria  ',
    avatarUrl: null,
    voiceId: 'voice-1',
    language: 'en-US',
    videoAspect: '9:16',
    videoLayout: 'standard',
    hookPanel: null,
    aiLabel: null,
    scriptPrompt: null,
    ctaType: 'follow',
    ctaUrl: null,
    ctaInstruction: null,
    paragraphNumber: null,
    niche: 'travel',
    faceQuality: 'ok',
    videoSubject: null,
    identityCard: null,
    publishingAccounts: emptyPersonaDefaultAccounts(),
    ...overrides,
  };
}

const base = { personaId: 'p1', userId: 'u1', photoPath: 'u1/p1/photo.png', avatarUrl: null };

describe('buildPersonaInsertRow', () => {
  it('builds the insert row with the identifiers, trimmed name and preference columns', () => {
    const row = buildPersonaInsertRow({ ...base, values: values() });
    expect(row).toMatchObject({
      id: 'p1',
      user_id: 'u1',
      name: 'Maria',
      photo_path: 'u1/p1/photo.png',
      avatar_url: null,
      voice_id: 'voice-1',
      language: 'en-US',
      niche: 'travel',
      hook_panel: true,
      recent_image_ids: [],
    });
  });

  it('stores null when the persona has no card', () => {
    expect(buildPersonaInsertRow({ ...base, values: values() }).identity_card).toBeNull();
  });

  it('stores the card when one is given', () => {
    expect(buildPersonaInsertRow({ ...base, values: values({ identityCard: FIXTURE_CARD }) }).identity_card).toEqual(FIXTURE_CARD);
  });

  it('falls back to an empty name when the form carried none', () => {
    expect(buildPersonaInsertRow({ ...base, values: values({ name: null }) }).name).toBe('');
  });
});
