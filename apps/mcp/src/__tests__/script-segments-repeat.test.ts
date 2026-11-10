import { describe, expect, it } from 'vitest';
// The repeat rule is material-independent, so these sparse fixtures run
// with fullLipsync true (media optional): the images density rule would
// fire first on one photo per segment.
import { validateSegments } from '../script-segments.js';

const REPEAT_RULE = 'the same photo must not repeat';
const REPEAT_FIX = 'Use a different photo for each media item.';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function segments(): Array<Record<string, unknown>> {
  return [
    { kind: 'hook', text: hook },
    { kind: 'body', text: body },
    { kind: 'cta', text: cta },
  ];
}

describe('validateSegments repeated photos', () => {
  it('rejects the same mediaId on a later segment and names the second item', () => {
    const input = segments();
    input[0] = { ...input[0], media: [{ mediaId: 'photo-1' }] };
    input[1] = { ...input[1], media: [{ mediaId: 'photo-1' }] };
    const result = validateSegments(input, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.media.0');
    expect(result.error.rule).toBe(REPEAT_RULE);
    expect(result.error.fix).toBe(REPEAT_FIX);
  });

  it('rejects the same url twice inside one segment at the second item', () => {
    const input = segments();
    input[1] = {
      ...input[1],
      media: [{ url: 'https://example.com/a.jpg' }, { url: 'https://example.com/a.jpg' }],
    };
    const result = validateSegments(input, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.media.1');
    expect(result.error.rule).toBe(REPEAT_RULE);
    expect(result.error.fix).toBe(REPEAT_FIX);
  });

  it('treats a trimmed mediaId as the same photo', () => {
    const input = segments();
    input[0] = { ...input[0], media: [{ mediaId: 'photo-1' }] };
    input[2] = { ...input[2], media: [{ mediaId: '  photo-1  ' }] };
    const result = validateSegments(input, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.2.media.0');
    expect(result.error.rule).toBe(REPEAT_RULE);
    expect(result.error.fix).toBe(REPEAT_FIX);
  });

  it('accepts distinct photos, including the same characters as mediaId and as url', () => {
    const input = segments();
    input[0] = { ...input[0], media: [{ mediaId: 'photo-1' }] };
    input[1] = { ...input[1], media: [{ url: 'photo-1' }, { url: 'https://example.com/b.jpg' }] };
    const result = validateSegments(input, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mediaCount).toBe(3);
  });

  it('rejects a repeated url in images mode when the photo count would otherwise pass', () => {
    const input = segments();
    input[0] = {
      ...input[0],
      media: [
        { url: 'https://example.com/a.jpg' },
        { url: 'https://example.com/b.jpg' },
        { url: 'https://example.com/a.jpg' },
      ],
    };
    const result = validateSegments(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.0.media.2');
    expect(result.error.rule).toBe(REPEAT_RULE);
    expect(result.error.fix).toBe(REPEAT_FIX);
  });
});
