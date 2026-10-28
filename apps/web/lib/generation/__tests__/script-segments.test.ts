import { describe, expect, it } from 'vitest';
import { joinSegments, validateSegments } from '../script-segments';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

function validSegments() {
  return [
    { kind: 'hook', text: hook },
    { kind: 'body', text: body },
    { kind: 'cta', text: cta },
  ];
}

describe('validateSegments', () => {
  it('accepts a valid hook, body and CTA and joins them with blank lines', () => {
    const result = validateSegments(validSegments());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hookText).toBe(hook);
    expect(result.value.ctaText).toBe(cta);
    expect(result.value.bodyWords).toBeGreaterThanOrEqual(30);
    expect(joinSegments(validSegments())).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });

  it('strips padding before joining, matching the engine join the TaskVideoRequest validator compares against', () => {
    const padded = [
      { kind: 'hook', text: `  ${hook}  ` },
      { kind: 'body', text: `  ${body} ` },
      { kind: 'cta', text: `${cta}   ` },
    ];
    expect(joinSegments(padded)).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });

  it('rejects empty segments with the segments field', () => {
    const result = validateSegments([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.fix.length).toBeGreaterThan(0);
  });

  it('rejects a hook that is not first and a CTA that is not last', () => {
    const noHookFirst = validateSegments([
      { kind: 'body', text: body },
      { kind: 'hook', text: hook },
      { kind: 'cta', text: cta },
    ]);
    expect(noHookFirst.ok).toBe(false);
    const noCtaLast = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'cta', text: cta },
      { kind: 'body', text: body },
    ]);
    expect(noCtaLast.ok).toBe(false);
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
        { kind: 'body', text: `${body} ${bad}` },
        { kind: 'cta', text: cta },
      ]);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a hook without terminal punctuation', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook.replace(/\.$/, '') },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.0.text');
  });

  it('rejects a repeated segment, a short body and an out-of-range CTA', () => {
    expect(
      validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'body', text: body },
        { kind: 'body', text: body },
        { kind: 'cta', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'body', text: 'Short body text here.' },
        { kind: 'cta', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: hook },
        { kind: 'body', text: body },
        { kind: 'cta', text: 'Save it.' },
      ]).ok,
    ).toBe(false);
  });

  it('rejects totals outside 60-200 words', () => {
    const short = validateSegments([
      { kind: 'hook', text: Array.from({ length: 20 }, () => 'word').join(' ') + '.' },
      { kind: 'body', text: Array.from({ length: 30 }, () => 'word').join(' ') + '.' },
      { kind: 'cta', text: 'Save this video now please.' },
    ]);
    expect(short.ok).toBe(false);
    // Above-maximum case: every component is in range, only the total exceeds 200.
    const long = validateSegments([
      { kind: 'hook', text: Array.from({ length: 30 }, () => 'word').join(' ') + '.' },
      { kind: 'body', text: Array.from({ length: 160 }, () => 'word').join(' ') + '.' },
      { kind: 'cta', text: Array.from({ length: 20 }, () => 'word').join(' ') + '.' },
    ]);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.field).toBe('segments');
  });

  it('rejects more than 12 segments inside the word total, via the cap rule', () => {
    // 20 + 11*14 + 5 = 179 words: inside the 60-200 total, so the segment
    // cap rule is what fires, not the total rule.
    const hook20 = Array.from({ length: 20 }, () => 'word').join(' ') + '.';
    const segments: Array<{ kind: string; text: string }> = [{ kind: 'hook', text: hook20 }];
    for (let i = 0; i < 11; i += 1) {
      segments.push({ kind: 'body', text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.` });
    }
    segments.push({ kind: 'cta', text: 'Save this video now please.' });
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.rule).toBe('at most 12 segments are allowed');
  });

  it('rejects a hook with fewer than 15 or more than 40 words before TTS', () => {
    expect(
      validateSegments([
        { kind: 'hook', text: 'Short hook here today.' },
        { kind: 'body', text: body },
        { kind: 'cta', text: cta },
      ]).ok,
    ).toBe(false);
    expect(
      validateSegments([
        { kind: 'hook', text: Array.from({ length: 41 }, () => 'word').join(' ') + '.' },
        { kind: 'body', text: body },
        { kind: 'cta', text: cta },
      ]).ok,
    ).toBe(false);
  });

  it('rejects media with both mediaId and url', () => {
    const both = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: 'abc', url: 'https://example.com/x.jpg' } },
      { kind: 'cta', text: cta },
    ]);
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.error.field).toBe('segments.1.media');
  });

  it('rejects more than 6 medias inside the word total, via the cap rule', () => {
    // 20 + 7*14 + 5 = 123 words and 9 segments: inside the total and the
    // segment cap, so the media cap rule is what fires.
    const hook20 = Array.from({ length: 20 }, () => 'word').join(' ') + '.';
    const segments: Array<{ kind: string; text: string; media?: { url: string } }> = [{ kind: 'hook', text: hook20 }];
    for (let i = 0; i < 7; i += 1) {
      segments.push({
        kind: 'body',
        text: Array.from({ length: 12 }, () => 'body').join(' ') + ` number ${i}.`,
        media: { url: `https://example.com/${i}.jpg` },
      });
    }
    segments.push({ kind: 'cta', text: 'Save this video now please.' });
    const result = validateSegments(segments);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments');
    expect(result.error.rule).toBe('at most 6 medias are allowed per video');
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
    const neither = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: {} },
      { kind: 'cta', text: cta },
    ]);
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.error.field).toBe('segments.1.media');
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
    const notObject = validateSegments([{ kind: 'hook', text: hook }, 'not a segment', { kind: 'cta', text: cta }]);
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.error.field).toBe('segments.1');
  });

  it('accepts a valid media shape and counts medias', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: 'abc' } },
      { kind: 'body', text: `${body} Second part.`, media: { url: 'https://example.com/x.jpg' }, terms: ['restaurant kitchen'] },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mediaCount).toBe(2);
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
});
