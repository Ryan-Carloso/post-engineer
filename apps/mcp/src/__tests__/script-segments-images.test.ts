import { describe, expect, it } from 'vitest';
import {
  IMAGES_MATERIAL,
  MAX_IMAGES_MODE_MEDIAS,
  MAX_MEDIAS,
  MAX_SEGMENTS,
  joinSegments,
  validateSegments,
} from '../script-segments.js';

//---------------
// The images material (issue #481): the agent's segment photos are the
// whole picture, so every segment needs media and the cap is one per
// segment. Mirrors the web copy and the engine's
// validate_segments(segments, "images").
//---------------
const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function withMedia(): Array<Record<string, unknown>> {
  return [
    { kind: 'hook', text: hook, media: { url: 'https://e.com/0.jpg' } },
    { kind: 'body', text: body, media: { url: 'https://e.com/1.jpg' } },
    { kind: 'cta', text: cta, media: { url: 'https://e.com/2.jpg' } },
  ];
}

// 20 + count*14 + 5 words, every segment with media: inside the word total
// and the segment cap for count <= 10.
function manyMedia(count: number): Array<Record<string, unknown>> {
  const segments: Array<Record<string, unknown>> = [
    { kind: 'hook', text: `${Array(20).fill('word').join(' ')}.`, media: { url: 'https://e.com/h.jpg' } },
  ];
  for (let i = 0; i < count; i += 1) {
    segments.push({
      kind: 'body',
      text: `${Array(12).fill('body').join(' ')} number ${i}.`,
      media: { url: `https://e.com/${i}.jpg` },
    });
  }
  segments.push({ kind: 'cta', text: 'Save this video now please.', media: { url: 'https://e.com/c.jpg' } });
  return segments;
}

describe('validateSegments with the images material', () => {
  it('names the material and caps media at one per segment', () => {
    expect(IMAGES_MATERIAL).toBe('images');
    expect(MAX_IMAGES_MODE_MEDIAS).toBe(MAX_SEGMENTS);
  });

  it('accepts media on every segment', () => {
    const result = validateSegments(withMedia(), 'images');
    expect(result.ok && result.value.mediaCount).toBe(3);
  });

  it('rejects a missing media on the segment that lacks it', () => {
    const segments = withMedia();
    delete segments[1].media;
    const result = validateSegments(segments, 'images');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('segments.1.media');
      expect(result.error.rule).toBe('the images material needs media on every segment');
    }
  });

  it('rejects a null media like a missing one', () => {
    const segments = withMedia();
    segments[2].media = null;
    const result = validateSegments(segments, 'images');
    expect(!result.ok && result.error.field).toBe('segments.2.media');
  });

  it('keeps media optional for other materials and when no material is given', () => {
    const segments = withMedia();
    delete segments[1].media;
    for (const material of ['broll', 'svg', undefined]) {
      expect(validateSegments(segments, material).ok).toBe(true);
    }
  });

  it('allows twelve media in images mode and still caps other materials at six', () => {
    expect(validateSegments(manyMedia(10), 'images').ok).toBe(true);
    const capped = validateSegments(manyMedia(5), 'broll');
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.error.rule).toBe(`at most ${MAX_MEDIAS} medias are allowed per video`);
      expect(capped.error.fix).toBe('Remove medias until at most 6 remain.');
    }
  });

  it('joinSegments validates with the same material', () => {
    const segments = withMedia();
    delete segments[0].media;
    expect(() => joinSegments(segments, 'images')).toThrow('segments.0.media');
    expect(joinSegments(segments)).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });
});
