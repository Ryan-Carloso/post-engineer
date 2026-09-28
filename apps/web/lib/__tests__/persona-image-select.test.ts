import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_HISTORY_LIMIT,
  PERSONA_IMAGE_WARNING_CODES,
  selectPersonaImage,
  type PersonaLibraryImage,
} from '../persona-image-select';

const img = (
  id: string,
  tag: string,
  description: string,
  isPrimary = false,
): PersonaLibraryImage => ({
  id,
  image_path: `${id}.png`,
  tag,
  description,
  is_primary: isPrimary,
});

const LIBRARY: PersonaLibraryImage[] = [
  img('img-casual', 'casual', 'woman in jeans and t-shirt at the park', true),
  img('img-formal', 'formal', 'business woman in a suit at the office'),
  img('img-beach', 'beach', 'woman in summer dress at the beach'),
];

describe('selectPersonaImage', () => {
  it('returns null for an empty library', () => {
    expect(selectPersonaImage([], { topic: 'business' }, [])).toBeNull();
  });

  it('explicit imageId wins over tag matching', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'business meeting at the office', imageId: 'img-beach' },
      [],
    );
    expect(picked?.id).toBe('img-beach');
  });

  it('unknown imageId returns null instead of silently substituting another face', () => {
    // The caller's pinned choice must never be quietly replaced by a
    // different photo: a future direct caller that skips the route's 404
    // check must get null (fail loudly) rather than a face the user
    // didn't pick.
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'business meeting at the office', imageId: 'nope' },
      [],
    );
    expect(picked).toBeNull();
  });

  it('picks the image whose tag matches the topic keywords', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'quarterly business review', niche: 'finance' },
      [],
    );
    expect(picked?.id).toBe('img-formal');
  });

  it('matches keywords from the description too', () => {
    const picked = selectPersonaImage(LIBRARY, { topic: 'summer vacation' }, []);
    expect(picked?.id).toBe('img-beach');
  });

  it('excludes recently used images', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'business meeting' },
      ['img-formal'],
    );
    // img-formal would win on tags, but it was used recently.
    expect(picked?.id).not.toBe('img-formal');
    expect(picked?.id).toBe('img-casual');
  });

  it('falls back to the full set when every image is recent (never fails)', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'business meeting' },
      ['img-casual', 'img-formal', 'img-beach'],
    );
    expect(picked?.id).toBe('img-formal');
  });

  it('primary image wins ties on equal scores', () => {
    const picked = selectPersonaImage(LIBRARY, { topic: 'unrelated xyz' }, []);
    expect(picked?.id).toBe('img-casual');
  });

  it('higher relevance beats the primary flag', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { topic: 'beach day' },
      [],
    );
    expect(picked?.id).toBe('img-beach');
  });

  it('exposes the documented limits', () => {
    expect(MAX_PERSONA_IMAGES).toBe(10);
    expect(PERSONA_IMAGE_HISTORY_LIMIT).toBe(3);
  });

  it('tokenizes non-Latin scripts (Cyrillic) for keyword matching', () => {
    // A Latin-only character class would produce an empty keyword set and
    // silently degrade to primary/first for non-Latin personas.
    const library = [
      img('img-ru', 'повседневный', 'женщина в джинсах в парке', true),
      img('img-en', 'formal', 'business woman in a suit'),
    ];
    const picked = selectPersonaImage(library, { topic: 'женщина в парке' }, []);
    expect(picked?.id).toBe('img-ru');
  });
});

describe('PERSONA_IMAGE_WARNING_CODES', () => {
  it('lives in this client-safe leaf module with the stable codes', () => {
    expect(PERSONA_IMAGE_WARNING_CODES).toEqual({
      PRIMARY_SWAP_FAILED: 'primary_swap_failed',
      METADATA_SAVE_FAILED: 'metadata_save_failed',
    });
  });

  it('keeps this module free of Node builtin imports (client components import it)', () => {
    // persona-image-library.tsx ('use client') imports the warning codes
    // from here: a Node builtin import (e.g. crypto for randomUUID) would
    // ride into the browser bundle. This module must stay dependency-free.
    // Resolved from the vitest cwd (apps/web); the web test task always
    // runs from there.
    const source = readFileSync(join(process.cwd(), 'lib', 'persona-image-select.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/from\s+['"]crypto['"]/);
  });

  it('is re-exported from persona-images for the server consumers', async () => {
    const serverModule = await import('../persona-images');
    expect(serverModule.PERSONA_IMAGE_WARNING_CODES).toBe(PERSONA_IMAGE_WARNING_CODES);
  });
});
