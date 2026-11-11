import { describe, expect, it } from 'vitest';
// Full lip sync leaves media optional: the overlay shape is what these
// tests pin, so every call runs with videoType 'full_lipsync'.
import {
  MAX_OVERLAY_BADGE_CHARS,
  MAX_OVERLAY_SUBTITLE_CHARS,
  MAX_OVERLAY_TITLE_CHARS,
  validateSegments,
} from '../script-segments.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function withOverlay(overlay: unknown) {
  return [
    { kind: 'hook', text: hook },
    { kind: 'body', text: body, media: [{ url: 'https://example.com/x.jpg', overlay }] },
    { kind: 'cta', text: cta },
  ];
}

describe('segment media overlay', () => {
  it('accepts a full card and counts it as one media', () => {
    const result = validateSegments(
      withOverlay({ title: 'Sushi Kinoshita', subtitle: 'Rua das Flores 12, Porto', badge: 'about 35 EUR' }),
      'full_lipsync',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mediaCount).toBe(1);
  });

  it('accepts a card with only a title', () => {
    expect(validateSegments(withOverlay({ title: 'Sushi Kinoshita' }), 'full_lipsync').ok).toBe(true);
  });

  it.each([
    ['a string', 'Sushi'],
    ['an array', ['Sushi']],
    ['no title', { subtitle: 'x' }],
    ['a blank title', { title: '   ' }],
    ['a numeric title', { title: 5 }],
    ['an empty subtitle', { title: 'Sushi', subtitle: '' }],
    ['a numeric subtitle', { title: 'Sushi', subtitle: 3 }],
    ['a blank badge', { title: 'Sushi', badge: '  ' }],
    ['an unknown key', { title: 'Sushi', price: '10' }],
  ])('rejects %s on the overlay field', (_name, overlay) => {
    const result = validateSegments(withOverlay(overlay), 'full_lipsync');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.1.media.0.overlay');
  });

  it.each([
    ['title', MAX_OVERLAY_TITLE_CHARS],
    ['subtitle', MAX_OVERLAY_SUBTITLE_CHARS],
    ['badge', MAX_OVERLAY_BADGE_CHARS],
  ])('accepts %s at its limit and rejects one character over', (key, limit) => {
    expect(validateSegments(withOverlay({ title: 'Sushi', [key]: 'x'.repeat(limit) }), 'full_lipsync').ok).toBe(true);
    const over = validateSegments(withOverlay({ title: 'Sushi', [key]: 'x'.repeat(limit + 1) }), 'full_lipsync');
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error.field).toBe('segments.1.media.0.overlay');
      expect(over.error.rule).toContain(String(limit));
    }
  });

  it('needs a photo to sit on', () => {
    const result = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'body', text: body, media: [{ overlay: { title: 'Sushi' } }] },
        { kind: 'cta', text: cta },
      ],
      'full_lipsync',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.1.media.0');
  });
});

describe('overlay in the tool schema', () => {
  const segmentsWith = (overlay: unknown) => [
    { kind: 'hook', text: hook },
    { kind: 'body', text: body, media: [{ url: 'https://example.com/x.jpg', overlay }] },
    { kind: 'cta', text: cta },
  ];
  const base = {
    title: 'Porto food',
    description: 'Agent description.',
    providers: ['youtube'],
    options: { videoType: 'hook_lipsync' as const },
  };

  it('parses a card and keeps it in the parsed segments', () => {
    const parsed = GeneratePersonaVideoSchema.parse({
      ...base,
      segments: segmentsWith({ title: 'Sushi', subtitle: 'Rua das Flores', badge: '35 EUR' }),
    });
    expect(parsed.segments[1].media?.[0]?.overlay).toEqual({ title: 'Sushi', subtitle: 'Rua das Flores', badge: '35 EUR' });
  });

  it.each([
    ['an unknown key', { title: 'Sushi', price: '1' }],
    ['no title', { subtitle: 'x' }],
    ['a title over the limit', { title: 'x'.repeat(MAX_OVERLAY_TITLE_CHARS + 1) }],
    ['a subtitle over the limit', { title: 'x', subtitle: 'x'.repeat(MAX_OVERLAY_SUBTITLE_CHARS + 1) }],
    ['a badge over the limit', { title: 'x', badge: 'x'.repeat(MAX_OVERLAY_BADGE_CHARS + 1) }],
  ])('rejects %s', (_name, overlay) => {
    expect(() =>
      GeneratePersonaVideoSchema.parse({ ...base, segments: segmentsWith(overlay) }),
    ).toThrow();
  });
});
