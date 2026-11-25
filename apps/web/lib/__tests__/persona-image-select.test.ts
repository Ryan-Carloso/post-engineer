import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_IMAGE_BYTES,
  MAX_PERSONA_IMAGES,
  ALLOWED_IMAGE_MIME_TYPES,
  PERSONA_IMAGE_HISTORY_LIMIT,
  PERSONA_IMAGE_WARNING_CODES,
  selectPersonaImage,
  type PersonaLibraryImage,
} from '../persona-image-select';
import { buildIdentityPrompt } from '../persona-identity-prompt';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';

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
    expect(selectPersonaImage([], { title: 'business' }, [])).toBeNull();
  });

  it('explicit imageId wins over tag matching', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'business meeting at the office', imageId: 'img-beach' },
      [],
    );
    expect(picked?.id).toBe('img-beach');
  });

  it('unknown imageId returns null instead of silently substituting another face', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'business meeting at the office', imageId: 'nope' },
      [],
    );
    expect(picked).toBeNull();
  });

  it('empty-string imageId returns null instead of falling through to automatic selection', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'business meeting at the office', imageId: '' },
      [],
    );
    expect(picked).toBeNull();
  });

  it('picks the image whose tag matches the title keywords', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'quarterly business review', niche: 'finance' },
      [],
    );
    expect(picked?.id).toBe('img-formal');
  });

  it('matches keywords from the description too', () => {
    const picked = selectPersonaImage(LIBRARY, { title: 'summer vacation' }, []);
    expect(picked?.id).toBe('img-beach');
  });

  it('excludes recently used images', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'business meeting' },
      ['img-formal'],
    );
    expect(picked?.id).not.toBe('img-formal');
    expect(picked?.id).toBe('img-casual');
  });

  it('falls back to the full set when every image is recent (never fails)', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'business meeting' },
      ['img-casual', 'img-formal', 'img-beach'],
    );
    expect(picked?.id).toBe('img-formal');
  });

  it('primary image wins ties on equal scores', () => {
    const picked = selectPersonaImage(LIBRARY, { title: 'unrelated xyz' }, []);
    expect(picked?.id).toBe('img-casual');
  });

  it('higher relevance beats the primary flag', () => {
    const picked = selectPersonaImage(
      LIBRARY,
      { title: 'beach day' },
      [],
    );
    expect(picked?.id).toBe('img-beach');
  });

  it('exposes the documented limits', () => {
    expect(MAX_PERSONA_IMAGES).toBe(10);
    expect(PERSONA_IMAGE_HISTORY_LIMIT).toBe(3);
  });

  it('tokenizes non-Latin scripts (Cyrillic) for keyword matching', () => {
    const library = [
      img('img-ru', 'повседневный', 'женщина в джинсах в парке', true),
      img('img-en', 'formal', 'business woman in a suit'),
    ];
    const picked = selectPersonaImage(library, { title: 'женщина в парке' }, []);
    expect(picked?.id).toBe('img-ru');
  });
});

describe('PERSONA_IMAGE_WARNING_CODES', () => {
  it('lives in this client-safe leaf module with the stable codes', () => {
    expect(PERSONA_IMAGE_WARNING_CODES).toEqual({
      PRIMARY_SWAP_FAILED: 'primary_swap_failed',
      METADATA_SAVE_FAILED: 'metadata_save_failed',
      ROW_REFETCH_FAILED: 'row_refetch_failed',
    });
  });

  it('keeps this module free of Node builtin imports (client components import it)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'persona-image-select.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/from\s+['"]crypto['"]/);
  });

  it('is re-exported from persona-images for the server consumers', async () => {
    const serverModule = await import('../persona-images');
    expect(serverModule.PERSONA_IMAGE_WARNING_CODES).toBe(PERSONA_IMAGE_WARNING_CODES);
  });
});

describe('shared upload limits', () => {
  it('exposes the client-safe upload limits with the enforced values', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect([...ALLOWED_IMAGE_MIME_TYPES].sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('is re-exported from persona-images for the server consumers', async () => {
    const serverModule = await import('../persona-images');
    expect(serverModule.MAX_IMAGE_BYTES).toBe(MAX_IMAGE_BYTES);
    expect(serverModule.ALLOWED_IMAGE_MIME_TYPES).toBe(ALLOWED_IMAGE_MIME_TYPES);
  });
});

describe('selectPersonaImage with a rendered suggestedDescription', () => {
  const gym = buildIdentityPrompt(FIXTURE_CARD, {
    lighting: 'warm_indoor',
    framing: 'full_body',
    setting: 'gym with mirrors',
    outfit: { top: 'black tank', footwear: 'running shoes' },
  }).suggestedDescription;
  const street = buildIdentityPrompt(FIXTURE_CARD, {
    lighting: 'golden_hour',
    framing: 'waist_up',
    setting: 'city street',
    outfit: { top: 'navy blazer' },
  }).suggestedDescription;
  const library = [
    img('img-gym', 'gym', gym),
    img('img-street', 'street', street),
    img('img-legacy', 'casual', 'woman in jeans and t-shirt at the park', true),
  ];

  it('scores a suggestedDescription on the scene keywords', () => {
    expect(selectPersonaImage(library, { title: 'mirrors workout' }, [])?.id).toBe('img-gym');
    expect(selectPersonaImage(library, { title: 'blazer on the street' }, [])?.id).toBe('img-street');
  });

  it('never matches on identity words because the description carries none', () => {
    expect(selectPersonaImage(library, { title: 'blonde wavy hair' }, [])?.id).toBe('img-legacy');
  });

  it('still picks hand-written descriptions exactly as before', () => {
    expect(selectPersonaImage(library, { title: 'park jeans' }, [])?.id).toBe('img-legacy');
    expect(selectPersonaImage(LIBRARY, { title: 'summer vacation' }, [])?.id).toBe('img-beach');
  });
});
