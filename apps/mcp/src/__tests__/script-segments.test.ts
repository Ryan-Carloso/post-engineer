import { describe, expect, it } from 'vitest';
import { joinSegments, validateSegments } from '../script-segments.js';
import { GeneratePersonaVideoSchema, ValidateScriptSchema } from '../single-video-shape.js';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

describe('validateSegments (shared module)', () => {
  it('accepts a valid hook, body and CTA and joins them with blank lines', () => {
    const segments = [
      { kind: 'hook', text: hook },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ];
    const result = validateSegments(segments);
    expect(result.ok).toBe(true);
    expect(joinSegments(segments)).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });

  it('strips padding before joining, matching the engine join the TaskVideoRequest validator compares against', () => {
    const padded = [
      { kind: 'hook', text: `  ${hook}  ` },
      { kind: 'body', text: `  ${body} ` },
      { kind: 'cta', text: `${cta}   ` },
    ];
    expect(joinSegments(padded)).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });

  it('rejects too many terms on a media-less segment, like the engine does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      {
        kind: 'body',
        text: body,
        terms: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'],
      },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.terms');
  });

  it('rejects a segment with an unknown key, like the engine does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, voice: 'narrator' },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1');
  });

  it('rejects media with an unknown key, like the generation route does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: 'abc', alt: 'kitchen' } },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.media');
  });

  it('does not treat double-space or underscore differences as repeats, like the engine does', () => {
    const baseBody =
      'The hello_world kitchen in Porto serves fresh fish with local bread and sweet dessert after lunch today while guests enjoy stories music and warm light before they walk home happy tonight.';
    const doubleSpaced = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: baseBody },
      { kind: 'body', text: baseBody.replace(/ /g, '  ') },
      { kind: 'cta', text: cta },
    ]);
    expect(doubleSpaced.ok).toBe(true);
    const underscore = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: baseBody },
      { kind: 'body', text: baseBody.replace('hello_world', 'helloworld') },
      { kind: 'cta', text: cta },
    ]);
    expect(underscore.ok).toBe(true);
  });

  it('still treats case and punctuation only differences as repeats', () => {
    const baseBody =
      'The hello_world kitchen in Porto serves fresh fish with local bread and sweet dessert after lunch today while guests enjoy stories music and warm light before they walk home happy tonight.';
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: baseBody },
      { kind: 'body', text: baseBody.toUpperCase().replace(/\.$/, '!') },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.2.text');
  });

  it('mirrors the engine media shape: blank values count as present, null is skipped', () => {
    const blankUrl = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: 'abc', url: '' } },
      { kind: 'cta', text: cta },
    ]);
    expect(blankUrl.ok).toBe(false);
    if (!blankUrl.ok) expect(blankUrl.error.field).toBe('segments.1.media');
    const blankId = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: '   ' } },
      { kind: 'cta', text: cta },
    ]);
    expect(blankId.ok).toBe(false);
    if (!blankId.ok) expect(blankId.error.field).toBe('segments.1.media');
    const nullMedia = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: null },
      { kind: 'cta', text: cta },
    ]);
    expect(nullMedia.ok).toBe(true);
  });

  it('reports the engine field for a bad kind and a short body', () => {
    const badKind = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'middle', text: body },
      { kind: 'cta', text: cta },
    ]);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error.field).toBe('segments.1.kind');
    const shortBody = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: 'Short body text here.' },
      { kind: 'cta', text: cta },
    ]);
    expect(shortBody.ok).toBe(false);
    if (!shortBody.ok) expect(shortBody.error.field).toBe('segments.1.text');
  });

  it('rejects more than 12 segments and more than 6 medias via the cap rules', () => {
    // 20 + 11*14 + 5 = 179 words: inside the total, so the segment cap fires.
    const hook20 = Array.from({ length: 20 }, () => 'word').join(' ') + '.';
    const segments: Array<{ kind: string; text: string }> = [{ kind: 'hook', text: hook20 }];
    for (let i = 0; i < 11; i += 1) {
      segments.push({ kind: 'body', text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.` });
    }
    segments.push({ kind: 'cta', text: 'Save this video now please.' });
    const many = validateSegments(segments);
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error.rule).toBe('at most 12 segments are allowed');
    // 20 + 7*14 + 5 = 123 words and 9 segments: only the media cap fires.
    const mediaSegments: Array<{ kind: string; text: string; media?: { url: string } }> = [{ kind: 'hook', text: hook20 }];
    for (let i = 0; i < 7; i += 1) {
      mediaSegments.push({
        kind: 'body',
        text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.`,
        media: { url: `https://example.com/${i}.jpg` },
      });
    }
    mediaSegments.push({ kind: 'cta', text: 'Save this video now please.' });
    const manyMedia = validateSegments(mediaSegments);
    expect(manyMedia.ok).toBe(false);
    if (!manyMedia.ok) expect(manyMedia.error.rule).toBe('at most 6 medias are allowed per video');
  });
});

describe('validateSegments (fail paths reformatted by the shared copy)', () => {
  it('rejects a non-array and an empty array', () => {
    for (const input of ['nope', []]) {
      const result = validateSegments(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('segments');
    }
  });

  it('rejects a last segment that is not the CTA', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body },
      { kind: 'body', text: body },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.2.kind');
  });

  it('rejects a script with no body segment', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments');
  });

  it('rejects a link inside a segment', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: `${body} https://example.com/menu` },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.1.text');
  });

  it('rejects a hook without terminal punctuation', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook.replace(/\.$/, '') },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.0.text');
  });

  it('rejects a CTA outside the 5-20 word range', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body },
      { kind: 'cta', text: 'Save this video.' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.2.text');
  });

  it('rejects a hook outside the 15-40 word range', () => {
    const result = validateSegments([
      { kind: 'hook', text: 'Stop wasting your trip today.' },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.0.text');
  });

  it('rejects a script below the 60 word total', () => {
    const shortHook = 'Stop wasting your trip stuck in a ninety minute line for the original dish today.';
    const body30 = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') + '.';
    const result = validateSegments([
      { kind: 'hook', text: shortHook },
      { kind: 'body', text: body30 },
      { kind: 'cta', text: 'Save this video before bed.' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.rule).toBe('the script must be 60-200 words in total');
  });

  it('rejects media with neither mediaId nor url', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: {} },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('segments.1.media');
  });
});

describe('tool schemas (strict segment objects)', () => {
  const valid = {
    segments: [
      { kind: 'hook', text: hook },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ],
    title: 'Porto food',
    providers: ['youtube'],
  };

  it('rejects unknown segment and media keys at parse time instead of stripping them', () => {
    expect(() =>
      GeneratePersonaVideoSchema.parse({
        ...valid,
        segments: [
          { kind: 'hook', text: hook },
          { kind: 'body', text: body, voice: 'narrator' },
          { kind: 'cta', text: cta },
        ],
      }),
    ).toThrow();
    expect(() =>
      GeneratePersonaVideoSchema.parse({
        ...valid,
        segments: [
          { kind: 'hook', text: hook },
          { kind: 'body', text: body, media: { mediaId: 'abc', alt: 'kitchen' } },
          { kind: 'cta', text: cta },
        ],
      }),
    ).toThrow();
    expect(() =>
      ValidateScriptSchema.parse({
        segments: [
          { kind: 'hook', text: hook },
          { kind: 'body', text: body, voice: 'narrator' },
          { kind: 'cta', text: cta },
        ],
      }),
    ).toThrow();
    expect(GeneratePersonaVideoSchema.parse(valid).segments).toHaveLength(3);
  });
});
