import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGES_MODE_MEDIAS,
  MAX_MEDIAS,
  MIN_WORDS_PER_IMAGE,
  WORDS_PER_IMAGE,
  joinSegments,
  validateSegments,
} from '@/lib/generation/script-segments';

// The images material: every segment carries a list of photos, about one
// per ~3s of speech. Mirrors validate_segments(segments, "images").
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, index) => ({ url: `https://e.com/${prefix}${index}.jpg` }));
}

function withMedia(): Array<Record<string, unknown>> {
  return [
    { kind: 'hook', text: hook, media: photos(3, 'h') },
    { kind: 'body', text: body, media: photos(6, 'b') },
    { kind: 'cta', text: cta, media: photos(2, 'c') },
  ];
}

function manyMedia(count: number): Array<Record<string, unknown>> {
  const segments: Array<Record<string, unknown>> = [
    { kind: 'hook', text: `${Array(20).fill('word').join(' ')}.`, media: photos(1, 'h') },
  ];
  for (let i = 0; i < count; i += 1) {
    segments.push({
      kind: 'body',
      text: `${Array(12).fill('body').join(' ')} number ${i}.`,
      media: photos(1, `${i}-`),
    });
  }
  segments.push({ kind: 'cta', text: 'Save this video now please.', media: photos(1, 'c') });
  return segments;
}

describe('validateSegments with the images material', () => {
  it('names the rhythm: one image per 8 words, at most 30', () => {
    expect(WORDS_PER_IMAGE).toBe(8);
    expect(MIN_WORDS_PER_IMAGE).toBe(3);
    expect(MAX_IMAGES_MODE_MEDIAS).toBe(30);
  });

  it('accepts enough photos on every segment', () => {
    const result = validateSegments(withMedia());
    expect(result.ok && result.value.mediaCount).toBe(11);
  });

  it('rejects a 32-word segment that has only one photo and says how many are missing', () => {
    const segments = withMedia();
    segments[1] = { kind: 'body', text: Array(32).fill('word').join(' '), media: photos(1, 'few') };
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.1.media');
      expect(result.error.rule).toBe(
        'segment has 32 words (~12s) and needs at least 4 images (one per ~3s); it has 1.',
      );
      expect(result.error.fix).toBe("Add 3 more images to this segment's media array.");
    }
  });

  it('accepts four photos on that 32-word segment and rejects eleven', () => {
    const enough = withMedia();
    enough[1] = { kind: 'body', text: Array(32).fill('word').join(' '), media: photos(4, 'ok') };
    const passed = validateSegments(enough);
    expect(passed.ok && passed.value.mediaCount).toBe(9);
    const tooMany = withMedia();
    tooMany[1] = { kind: 'body', text: Array(32).fill('word').join(' '), media: photos(11, 'many') };
    const failed = validateSegments(tooMany);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.rule).toBe(
        'segment has 32 words (~12s) and allows at most 10 images (each image needs ~1s); it has 11.',
      );
      expect(failed.error.fix).toBe('Remove images until this segment has at most 10.');
    }
  });

  it('rejects more than 30 photos even when each segment stays inside its own array cap', () => {
    const result = validateSegments([
      { kind: 'hook', text: `${Array(40).fill('hook').join(' ')}.`, media: photos(13, 'h') },
      { kind: 'body', text: `${Array(140).fill('body').join(' ')}.`, media: photos(18, 'b') },
      { kind: 'cta', text: `${Array(20).fill('save').join(' ')}.`, media: photos(6, 'c') },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.rule).toBe('at most 30 medias are allowed per video');
  });

  it('names the merge escape when the per-segment minimums exceed the 30-photo cap', () => {
    // Hook 25 words + six 25-word body segments + a 20-word CTA = 195 words.
    // Every segment meets its density minimum (4, 4x6, 3 = 31 photos) yet the
    // 30-photo cap fires, and removing any photo re-triggers density — so the
    // cap fix must name merging segments as the way out.
    const segments = [
      { kind: 'hook', text: `${Array(25).fill('hook').join(' ')}.`, media: photos(4, 'h') },
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: 'body',
        text: Array(25).fill(`body${i}`).join(' '),
        media: photos(4, `b${i}-`),
      })),
      { kind: 'cta', text: Array(20).fill('cta').join(' '), media: photos(3, 'c') },
    ];
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.rule).toBe('at most 30 medias are allowed per video');
      expect(result.error.fix).toContain('merge segments');
    }
  });

  it('rejects a missing media on the segment that lacks it', () => {
    const segments = withMedia();
    delete segments[1].media;
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.1.media');
      expect(result.error.rule).toBe('the images material needs media on every segment');
    }
  });

  it('rejects a null media like a missing one', () => {
    const segments = withMedia();
    segments[2].media = null;
    const result = validateSegments(segments);
    expect(!result.ok && result.error.field).toBe('segments.2.media');
  });

  it('rejects an item with neither mediaId nor url on that item', () => {
    const segments = withMedia();
    segments[1] = { kind: 'body', text: body, media: [{}, ...photos(5, 'b')] };
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.1.media.0');
  });

  it('keeps media optional for full lip sync, required otherwise', () => {
    const segments = withMedia();
    delete segments[1].media;
    expect(validateSegments(segments, 'full_lipsync').ok).toBe(true);
    expect(validateSegments(segments, 'hook_lipsync').ok).toBe(false);
    expect(validateSegments(segments, 'faceless').ok).toBe(false);
    expect(validateSegments(segments).ok).toBe(false);
  });

  it('still caps full lip sync at six medias', () => {
    const capped = validateSegments(manyMedia(5), 'full_lipsync');
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.error.rule).toBe(`at most ${MAX_MEDIAS} medias are allowed per video`);
      expect(capped.error.fix).toBe('Remove medias until at most 6 remain.');
    }
  });

  it('joinSegments validates with the same full-lip-sync flag', () => {
    const segments = [
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: photos(1, 'b') },
      { kind: 'cta', text: cta, media: photos(1, 'c') },
    ];
    expect(() => joinSegments(segments)).toThrow('segments.0.media');
    expect(joinSegments(segments, 'full_lipsync')).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });
});
