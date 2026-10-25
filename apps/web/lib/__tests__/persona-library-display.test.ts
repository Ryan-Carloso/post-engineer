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
});
