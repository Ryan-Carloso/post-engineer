import { describe, expect, it } from 'vitest';

import { pickLibraryDisplayImage, type LibraryDisplayImage } from '@/lib/persona-library-display';

function img(
  overrides: Partial<LibraryDisplayImage> & Pick<LibraryDisplayImage, 'id' | 'persona_id'>,
): LibraryDisplayImage {
  return {
    image_path: `${overrides.persona_id}/${overrides.id}.png`,
    is_primary: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('pickLibraryDisplayImage', () => {
  it('prefers the primary over a newer image', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'newer', persona_id: 'p-1', created_at: '2026-02-01T00:00:00Z', is_primary: false }),
        img({ id: 'primary', persona_id: 'p-1', created_at: '2026-01-01T00:00:00Z', is_primary: true }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('primary');
  });

  it('uses created_at desc then id desc when none is primary', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'a', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
        img({ id: 'c', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
        img({ id: 'b', persona_id: 'p-1', created_at: '2026-01-01T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('c');
  });

  it('returns nothing for an empty list', () => {
    expect(pickLibraryDisplayImage([], 'p-1')).toBeUndefined();
  });

  it('returns the only image for that persona', () => {
    const picked = pickLibraryDisplayImage(
      [img({ id: 'solo', persona_id: 'p-1' })],
      'p-1',
    );
    expect(picked?.id).toBe('solo');
  });

  it('treats only is_primary true as primary', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'not-primary', persona_id: 'p-1', is_primary: false, created_at: '2026-03-01T00:00:00Z' }),
        img({ id: 'primary', persona_id: 'p-1', is_primary: true, created_at: '2026-01-01T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('primary');
  });

  it('does not mix personas', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'other-primary', persona_id: 'p-2', is_primary: true }),
        img({ id: 'mine', persona_id: 'p-1', is_primary: false }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('mine');
  });

  it('returns nothing when every row belongs to another persona', () => {
    expect(
      pickLibraryDisplayImage(
        [img({ id: 'other', persona_id: 'p-2', is_primary: true })],
        'p-1',
      ),
    ).toBeUndefined();
  });

  it('keeps the newest primary when two rows are marked primary', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'first-primary', persona_id: 'p-1', is_primary: true, created_at: '2026-01-01T00:00:00Z' }),
        img({ id: 'second-primary', persona_id: 'p-1', is_primary: true, created_at: '2026-03-01T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('second-primary');
  });

  it('picks the newest created_at when the array is oldest-first', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'old', persona_id: 'p-1', created_at: '2026-01-01T00:00:00Z' }),
        img({ id: 'new', persona_id: 'p-1', created_at: '2026-04-01T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('new');
  });

  it('breaks a created_at tie with the larger id', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'aa', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
        img({ id: 'ab', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('ab');
  });

  it('picks the largest id among three same-timestamp rows', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'm', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
        img({ id: 'z', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
        img({ id: 'a', persona_id: 'p-1', created_at: '2026-01-02T00:00:00Z' }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('z');
  });

  it('ignores a newer image that belongs to another persona', () => {
    const picked = pickLibraryDisplayImage(
      [
        img({ id: 'mine-old', persona_id: 'p-1', created_at: '2026-01-01T00:00:00Z' }),
        img({ id: 'other-new', persona_id: 'p-2', created_at: '2026-12-01T00:00:00Z', is_primary: true }),
      ],
      'p-1',
    );
    expect(picked?.id).toBe('mine-old');
  });
});

