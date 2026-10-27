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

  it('rejects totals outside 60-200 words and more than 12 segments', () => {
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
    const many = [{ kind: 'hook', text: hook }];
    for (let i = 0; i < 11; i += 1) {
      many.push({ kind: 'body', text: `${body} Variation ${i}.` });
    }
    many.push({ kind: 'cta', text: cta });
    expect(validateSegments(many).ok).toBe(false);
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

  it('rejects media with both mediaId and url, and more than 6 medias', () => {
    const both = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, media: { mediaId: 'abc', url: 'https://example.com/x.jpg' } },
      { kind: 'cta', text: cta },
    ]);
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.error.field).toBe('segments.1.media');
    const manyMedia: Array<{ kind: string; text: string; media?: { url: string } }> = [{ kind: 'hook', text: hook }];
    for (let i = 0; i < 7; i += 1) {
      manyMedia.push({ kind: 'body', text: `${body} Extra ${i}.`, media: { url: `https://example.com/${i}.jpg` } });
    }
    manyMedia.push({ kind: 'cta', text: cta });
    expect(validateSegments(manyMedia).ok).toBe(false);
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
});
