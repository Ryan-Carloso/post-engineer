import { describe, expect, it } from 'vitest';
import { joinSegments, validateSegments } from '../script-segments';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function validSegments() {
  return [
    { kind: 'hook', text: hook },
    { kind: 'content', text: content },
    { kind: 'content', text: cta },
  ];
}

describe('validateSegments', () => {
  it('accepts a valid hook and content takes and joins them with blank lines', () => {
    const result = validateSegments(validSegments(), 'full_lipsync');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookText).toBe(hook);
    expect(result.value.contentTexts).toEqual([content, cta]);
    expect(result.value.contentWords).toBeGreaterThanOrEqual(30);
    expect(joinSegments(validSegments(), 'full_lipsync')).toBe(`${hook}\n\n${content}\n\n${cta}`);
  });

  it('strips padding before joining, matching the engine join the TaskVideoRequest validator compares against', () => {
    const padded = [
      { kind: 'hook', text: `  ${hook}  ` },
      { kind: 'content', text: `  ${content} ` },
      { kind: 'content', text: `${cta}   ` },
    ];
    expect(joinSegments(padded, 'full_lipsync')).toBe(`${hook}\n\n${content}\n\n${cta}`);
  });

  it('rejects empty segments with the segments field', () => {
    const result = validateSegments([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.fix.length).toBeGreaterThan(0);
  });

  it('rejects a hook that is not first', () => {
    const noHookFirst = validateSegments([
      { kind: 'content', text: content },
      { kind: 'hook', text: hook },
      { kind: 'content', text: cta },
    ]);
    expect(noHookFirst.ok).toBe(false);
  });

  it('accepts a CTA take in the middle of the video', () => {
    const segments = [
      { kind: 'hook', text: hook },
      { kind: 'content', text: cta },
      { kind: 'content', text: content },
    ];
    const result = validateSegments(segments, 'full_lipsync');
    expect(result.ok).toBe(true);
    expect(joinSegments(segments, 'full_lipsync')).toBe(`${hook}\n\n${cta}\n\n${content}`);
  });

  it('rejects placeholder, link, markdown, emoji and stage direction text', () => {
    const badTexts = [
      '[insira o texto aqui]',
      'TODO write this',
      'See https://example.com for more.',
      '**Bold claim**',
      'Hello \u{1F600}',
      '[pausa] hello',
    ];
    for (const bad of badTexts) {
      const result = validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'content', text: `${content} ${bad}` },
        { kind: 'content', text: cta },
      ]);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a hook without terminal punctuation', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook.replace(/\.$/, '') },
      { kind: 'content', text: content },
      { kind: 'content', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.0.text');
  });

  it('rejects a repeated segment and short content', () => {
    expect(
      validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'content', text: content },
        { kind: 'content', text: content },
        { kind: 'content', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'content', text: 'Short content text here.' },
        { kind: 'content', text: cta },
      ]).ok,
    ).toBe(false);
  });

  it('accepts short and long content takes: there is no CTA word range', () => {
    expect(
      validateSegments(
        [
          { kind: 'hook', text: hook },
          { kind: 'content', text: Array.from({ length: 35 }, () => 'word').join(' ') + '.' },
          { kind: 'content', text: 'Save it.' },
        ],
        'full_lipsync',
      ).ok,
    ).toBe(true);
    expect(
      validateSegments(
        [
          { kind: 'hook', text: hook },
          { kind: 'content', text: content },
          { kind: 'content', text: Array.from({ length: 21 }, () => 'word').join(' ') + '.' },
        ],
        'full_lipsync',
      ).ok,
    ).toBe(true);
  });

  it('rejects totals outside 60-200 words', () => {
    const short = validateSegments([
      { kind: 'hook', text: Array.from({ length: 20 }, () => 'word').join(' ') + '.' },
      { kind: 'content', text: Array.from({ length: 30 }, () => 'word').join(' ') + '.' },
      { kind: 'content', text: 'Save this video now please.' },
    ]);
    expect(short.ok).toBe(false);
    const long = validateSegments([
      { kind: 'hook', text: Array.from({ length: 30 }, () => 'word').join(' ') + '.' },
      { kind: 'content', text: Array.from({ length: 160 }, () => 'word').join(' ') + '.' },
      { kind: 'content', text: Array.from({ length: 20 }, () => 'word').join(' ') + '.' },
    ]);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.field).toBe('segments');
  });

  it('rejects more than 12 segments inside the word total, via the cap rule', () => {
    const hook25 = Array.from({ length: 25 }, () => 'word').join(' ') + '.';
    const segments: Array<{ kind: string; text: string }> = [{ kind: 'hook', text: hook25 }];
    for (let i = 0; i < 11; i += 1) {
      segments.push({ kind: 'content', text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.` });
    }
    segments.push({ kind: 'content', text: 'Save this video now please.' });
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.rule).toBe('at most 12 segments are allowed');
  });

  it('rejects a hook with fewer than 25 or more than 40 words before TTS', () => {
    expect(
      validateSegments([
        { kind: 'hook', text: 'Short hook here today.' },
        { kind: 'content', text: content },
        { kind: 'content', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: Array.from({ length: 24 }, () => 'word').join(' ') + '.' },
        { kind: 'content', text: content },
        { kind: 'content', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: Array.from({ length: 41 }, () => 'word').join(' ') + '.' },
        { kind: 'content', text: content },
        { kind: 'content', text: cta },
      ]).ok,
    ).toBe(false);
  });

  it('rejects media with both mediaId and url', () => {
    const both = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'content', text: content, media: [{ mediaId: 'abc', url: 'https://example.com/x.jpg' }] },
        { kind: 'content', text: cta },
      ],
      'full_lipsync',
    );
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.error.field).toBe('segments.1.media.0');
  });

  it('rejects more than 6 medias inside the word total, via the cap rule', () => {
    const hook25 = Array.from({ length: 25 }, () => 'word').join(' ') + '.';
    const segments: Array<{ kind: string; text: string; media?: Array<{ url: string }> }> = [{ kind: 'hook', text: hook25 }];
    for (let i = 0; i < 7; i += 1) {
      segments.push({
        kind: 'content',
        text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.`,
        media: [{ url: `https://example.com/${i}.jpg` }],
      });
    }
    segments.push({ kind: 'content', text: 'Save this video now please.' });
    const result = validateSegments(segments, 'full_lipsync');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.rule).toBe('at most 6 medias are allowed per video');
  });

  it('mirrors the engine media shape: blank values count as present, null is skipped', () => {
    const blankUrl = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: content, media: [{ mediaId: 'abc', url: '' }] },
      { kind: 'content', text: cta },
    ], 'full_lipsync');
    expect(blankUrl.ok).toBe(false);
    if (!blankUrl.ok) expect(blankUrl.error.field).toBe('segments.1.media.0');
    const blankId = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: content, media: [{ mediaId: '   ' }] },
      { kind: 'content', text: cta },
    ], 'full_lipsync');
    expect(blankId.ok).toBe(false);
    if (!blankId.ok) expect(blankId.error.field).toBe('segments.1.media.0');
    const neither = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: content, media: [{}] },
      { kind: 'content', text: cta },
    ], 'full_lipsync');
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.error.field).toBe('segments.1.media.0');
    const nullMedia = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: content, media: null },
      { kind: 'content', text: cta },
    ], 'full_lipsync');
    expect(nullMedia.ok).toBe(true);
  });

  it('reports the engine field for a bad kind and short content', () => {
    const badKind = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'middle', text: content },
      { kind: 'content', text: cta },
    ]);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error.field).toBe('segments.1.kind');
    const shortContent = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: 'Short content text here.' },
      { kind: 'content', text: cta },
    ]);
    expect(shortContent.ok).toBe(false);
    if (!shortContent.ok) expect(shortContent.error.field).toBe('segments.1.text');
    const notObject = validateSegments([{ kind: 'hook', text: hook }, 'not a segment', { kind: 'content', text: cta }]);
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.error.field).toBe('segments.1');
  });

  it('accepts a valid media shape and counts medias', () => {
    const result = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'content', text: content, media: [{ mediaId: 'abc' }] },
        { kind: 'content', text: `${content} Second part.`, media: [{ url: 'https://example.com/x.jpg' }] },
        { kind: 'content', text: cta },
      ],
      'full_lipsync',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mediaCount).toBe(2);
  });

  it('rejects a segment with an unknown key, like the engine does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: content, voice: 'narrator' },
      { kind: 'content', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1');
  });

  it('rejects media with an unknown key, like the generation route does', () => {
    const result = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'content', text: content, media: [{ mediaId: 'abc', alt: 'kitchen' }] },
        { kind: 'content', text: cta },
      ],
      'full_lipsync',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.media.0');
  });

  it('does not treat double-space or underscore differences as repeats, like the engine does', () => {
    const baseContent =
      'The hello_world kitchen in Porto serves fresh fish with local bread and sweet dessert after lunch today while guests enjoy stories music and warm light before they walk home happy tonight.';
    const doubleSpaced = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'content', text: baseContent },
        { kind: 'content', text: baseContent.replace(/ /g, '  ') },
        { kind: 'content', text: cta },
      ],
      'full_lipsync',
    );
    expect(doubleSpaced.ok).toBe(true);
    const underscore = validateSegments(
      [
        { kind: 'hook', text: hook },
        { kind: 'content', text: baseContent },
        { kind: 'content', text: baseContent.replace('hello_world', 'helloworld') },
        { kind: 'content', text: cta },
      ],
      'full_lipsync',
    );
    expect(underscore.ok).toBe(true);
  });

  it('still treats case and punctuation only differences as repeats', () => {
    const baseContent =
      'The hello_world kitchen in Porto serves fresh fish with local bread and sweet dessert after lunch today while guests enjoy stories music and warm light before they walk home happy tonight.';
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'content', text: baseContent },
      { kind: 'content', text: baseContent.toUpperCase().replace(/\.$/, '!') },
      { kind: 'content', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.2.text');
  });
});
