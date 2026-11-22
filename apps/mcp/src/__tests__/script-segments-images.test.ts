import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGES_MODE_MEDIAS,
  MAX_MEDIAS,
  MAX_PHOTO_SECONDS,
  MAX_REQUESTED_PHOTO_SECONDS,
  MIN_REQUESTED_PHOTO_SECONDS,
  MIN_WORDS_PER_IMAGE,
  WORDS_PER_IMAGE,
  joinSegments,
  validateSegments,
} from '../script-segments.js';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, index) => ({ url: `https://e.com/${prefix}${index}.jpg` }));
}

function clips(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, index) => ({ url: `https://e.com/${prefix}${index}.mp4` }));
}

function withMedia(): Array<Record<string, unknown>> {
  return [
    { kind: 'hook', text: hook, media: photos(4, 'h') },
    { kind: 'content', text: content, media: photos(8, 'b') },
    { kind: 'content', text: cta, media: photos(2, 'c') },
  ];
}

function manyMedia(count: number): Array<Record<string, unknown>> {
  const segments: Array<Record<string, unknown>> = [
    { kind: 'hook', text: `${Array(25).fill('word').join(' ')}.`, media: photos(1, 'h') },
  ];
  for (let i = 0; i < count; i += 1) {
    segments.push({
      kind: 'content',
      text: `${Array(12).fill('body').join(' ')} number ${i}.`,
      media: photos(1, `${i}-`),
    });
  }
  segments.push({ kind: 'content', text: 'Save this video now please.', media: photos(1, 'c') });
  return segments;
}

describe('validateSegments with the images material', () => {
  it('names the rhythm: one image per 2s of speech, at most 30', () => {
    expect(WORDS_PER_IMAGE).toBe(8);
    expect(MIN_WORDS_PER_IMAGE).toBe(3);
    expect(MAX_PHOTO_SECONDS).toBe(2);
    expect(MAX_IMAGES_MODE_MEDIAS).toBe(30);
  });

  it('accepts enough photos on every segment', () => {
    const result = validateSegments(withMedia());
    expect(result.ok && result.value.mediaCount).toBe(14);
  });

  it('rejects a 32-word segment that has only one photo and says how many are missing', () => {
    const segments = withMedia();
    segments[1] = { kind: 'content', text: Array(32).fill('word').join(' '), media: photos(1, 'few') };
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.1.media');
      expect(result.error.rule).toBe(
        'segment has 32 words (~12s) and needs at least 6 images (one per 2s); it has 1.',
      );
      expect(result.error.fix).toBe("Add 5 more images to this segment's media array.");
    }
  });

  it('rejects a script that passes the word count but cannot cover the audio at the 2s pace', () => {
    const segments = [
      { kind: 'hook', text: `${Array(25).fill('hook').join(' ')}.`, media: photos(4, 'h') },
      { kind: 'content', text: Array(60).fill('body').join(' '), media: photos(8, 'b') },
      { kind: 'content', text: Array(49).fill('final').join(' '), media: photos(8, 'f') },
    ];
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.1.media');
      expect(result.error.rule).toBe(
        'segment has 60 words (~23s) and needs at least 12 images (one per 2s); it has 8.',
      );
      expect(result.error.fix).toBe("Add 4 more images to this segment's media array.");
    }
  });

  it('hook photos do not count toward the minimum in hook-only videos', () => {
    const segments = [
      { kind: 'hook', text: `${Array(25).fill('hook').join(' ')}.`, media: photos(1, 'h') },
      { kind: 'content', text: Array(32).fill('body').join(' '), media: photos(6, 'b') },
      { kind: 'content', text: Array(8).fill('cta').join(' '), media: photos(2, 'c') },
    ];
    const passed = validateSegments(segments);
    expect(passed.ok && passed.value.mediaCount).toBe(9);
    const faceless = validateSegments(segments, 'faceless');
    expect(faceless.ok).toBe(false);
    if (!faceless.ok) {
      expect(faceless.error.field).toBe('segments.0.media');
      expect(faceless.error.rule).toBe(
        'segment has 25 words (~9s) and needs at least 5 images (one per 2s); it has 1.',
      );
      expect(faceless.error.fix).toBe("Add 4 more images to this segment's media array.");
    }
  });

  it('rejects a punctuation-only segment with a photo before charging', () => {
    const segments = withMedia();
    segments[2] = { kind: 'content', text: '... ... ... ... ...', media: photos(1, 'c') };
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.2.text');
      expect(result.error.rule).toBe(
        'The images material needs spoken words on every segment that carries media.',
      );
      expect(result.error.fix).toBe('Write real words for this segment, or move its photo to another segment.');
    }
  });

  it('still allows a punctuation-only segment in full lip sync', () => {
    const segments = withMedia();
    segments[0] = { kind: 'hook', text: hook, media: photos(1, 'h') };
    segments[1] = { kind: 'content', text: content, media: photos(1, 'b') };
    segments[2] = { kind: 'content', text: '... ... ... ... ...', media: photos(1, 'c') };
    const result = validateSegments(segments, 'full_lipsync');
    expect(result.ok).toBe(true);
  });

  it('accepts six photos on that 32-word segment and rejects eleven', () => {
    const enough = withMedia();
    enough[1] = { kind: 'content', text: Array(32).fill('word').join(' '), media: photos(6, 'ok') };
    const passed = validateSegments(enough);
    expect(passed.ok && passed.value.mediaCount).toBe(12);
    const tooMany = withMedia();
    tooMany[1] = { kind: 'content', text: Array(32).fill('word').join(' '), media: photos(11, 'many') };
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
    const result = validateSegments(
      [
        { kind: 'hook', text: `${Array(40).fill('hook').join(' ')}.`, media: photos(13, 'h') },
        { kind: 'content', text: `${Array(140).fill('body').join(' ')}.`, media: photos(27, 'b') },
        { kind: 'content', text: `${Array(20).fill('save').join(' ')}.`, media: photos(6, 'c') },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.rule).toBe('at most 30 medias are allowed per video');
  });

  it('names the merge escape when the per-segment minimums exceed the 30-photo cap', () => {
    const segments = [
      { kind: 'hook', text: `${Array(25).fill('hook').join(' ')}.`, media: photos(4, 'h') },
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: 'content',
        text: Array(25).fill(`body${i}`).join(' '),
        media: photos(5, `b${i}-`),
      })),
      { kind: 'content', text: Array(20).fill('cta').join(' '), media: photos(4, 'c') },
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
    segments[1] = { kind: 'content', text: content, media: [{}, ...photos(5, 'b')] };
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
      { kind: 'content', text: content, media: photos(1, 'b') },
      { kind: 'content', text: cta, media: photos(1, 'c') },
    ];
    expect(() => joinSegments(segments)).toThrow('segments.0.media');
    expect(joinSegments(segments, 'full_lipsync')).toBe(`${hook}\n\n${content}\n\n${cta}`);
  });

  it('one clip per take passes the density minimum', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook, media: clips(1, 'h') },
      { kind: 'content', text: content, media: clips(2, 'b') },
      { kind: 'content', text: 'Save this video now please.', media: photos(1, 'c') },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mediaCount).toBe(4);
  });

  it('one clip in a 40-word hook still fails the density minimum', () => {
    const segments = [
      { kind: 'hook', text: `${Array(40).fill('word').join(' ')}.`, media: clips(1, 'h') },
      { kind: 'content', text: content, media: clips(2, 'b') },
      { kind: 'content', text: 'Save this video now please.', media: photos(1, 'c') },
    ];
    const result = validateSegments(segments, 'faceless');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.0.media');
      expect(result.error.rule).toBe(
        'segment has 40 words (~15s) and needs at least 8 images (one per 2s); it has 1.',
      );
      expect(result.error.fix).toBe("Add 2 more images to this segment's media array.");
    }
  });

  it('the density maximum counts clips one for one', () => {
    const segments = [
      { kind: 'hook', text: hook, media: clips(1, 'h') },
      { kind: 'content', text: content, media: clips(2, 'b') },
      {
        kind: 'content',
        text: 'Save this video now please.',
        media: [...clips(1, 'c'), ...photos(2, 'c')],
      },
    ];
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.2.media');
      expect(result.error.rule).toBe(
        'segment has 5 words (~2s) and allows at most 1 image (each image needs ~1s); it has 3.',
      );
    }
  });
});

describe('validateSegments with a requested photo duration', () => {
  it('pins the requested-duration bounds to half a second and six seconds', () => {
    expect(MIN_REQUESTED_PHOTO_SECONDS).toBe(0.5);
    expect(MAX_REQUESTED_PHOTO_SECONDS).toBe(6);
  });

  it('accepts a requested duration in range on a photo', () => {
    const segments = withMedia();
    const media = (segments[1] as Record<string, unknown>).media as Array<Record<string, unknown>>;
    media[0] = { ...media[0], duration: 3 };
    media[1] = { ...media[1], duration: 0.5 };
    media[2] = { ...media[2], duration: 6 };
    media[3] = { ...media[3], duration: null };
    expect(validateSegments(segments).ok).toBe(true);
  });

  it.each([0, -1, 0.49, 6.01, 60, '3', true, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a duration of %s before charging',
    (duration) => {
      const segments = withMedia();
      const media = (segments[1] as Record<string, unknown>).media as Array<Record<string, unknown>>;
      media[0] = { ...media[0], duration };
      const result = validateSegments(segments);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('segments.1.media.0.duration');
        expect(result.error.fix).toBeTruthy();
      }
    },
  );
});
