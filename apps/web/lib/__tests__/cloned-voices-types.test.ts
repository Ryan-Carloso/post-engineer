import { describe, expect, it } from 'vitest';

import { narrowClonedVoiceRow } from '@/lib/cloned-voices-types';

describe('narrowClonedVoiceRow', () => {
  it('returns null for non-object values', () => {
    expect(narrowClonedVoiceRow(null)).toBeNull();
    expect(narrowClonedVoiceRow(undefined)).toBeNull();
    expect(narrowClonedVoiceRow('clone-1')).toBeNull();
    expect(narrowClonedVoiceRow(42)).toBeNull();
    expect(narrowClonedVoiceRow(true)).toBeNull();
  });

  it('returns null when id or status is not a string', () => {
    expect(narrowClonedVoiceRow({ status: 'ready' })).toBeNull();
    expect(narrowClonedVoiceRow({ id: 'clone-1' })).toBeNull();
    expect(narrowClonedVoiceRow({ id: 7, status: 'ready' })).toBeNull();
    expect(narrowClonedVoiceRow({ id: 'clone-1', status: null })).toBeNull();
  });

  it('keeps string optional fields and drops unknown extra fields', () => {
    const row = narrowClonedVoiceRow({
      id: 'clone-1',
      status: 'ready',
      language: 'pt',
      voice_id: 'chatterbox:u1',
      error_code: 'E1',
      consent_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      internal_secret: 'must-not-leak',
    });
    expect(row).toEqual({
      id: 'clone-1',
      status: 'ready',
      language: 'pt',
      voice_id: 'chatterbox:u1',
      error_code: 'E1',
      consent_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('coerces non-string optional fields to null', () => {
    const row = narrowClonedVoiceRow({
      id: 'clone-2',
      status: 'pending',
      language: 3,
      voice_id: undefined,
      error_code: { code: 'E' },
      consent_at: null,
      created_at: 123,
      updated_at: false,
    });
    expect(row).toEqual({
      id: 'clone-2',
      status: 'pending',
      language: null,
      voice_id: null,
      error_code: null,
      consent_at: null,
      created_at: null,
      updated_at: null,
    });
  });
});
