import { describe, expect, it } from 'vitest';
import { diffText } from '../text-diff';

describe('diffText', () => {
  it('marks a replaced word as removed then added and keeps the rest as same', () => {
    const result = diffText('Write a short hook', 'Write a punchy hook');
    expect(result.segments).toEqual([
      { kind: 'same', text: 'Write a ' },
      { kind: 'removed', text: 'short' },
      { kind: 'added', text: 'punchy' },
      { kind: 'same', text: ' hook' },
    ]);
    expect(result.addedWords).toBe(1);
    expect(result.removedWords).toBe(1);
    expect(result.granularity).toBe('word');
  });

  it('counts only inserted words when text is appended', () => {
    const result = diffText('Line one.', 'Line one.\nLine two here.');
    expect(result.segments).toEqual([
      { kind: 'same', text: 'Line one.' },
      { kind: 'added', text: '\nLine two here.' },
    ]);
    expect(result.addedWords).toBe(3);
    expect(result.removedWords).toBe(0);
  });

  it('returns one same segment for identical texts', () => {
    const result = diffText('same text', 'same text');
    expect(result.segments).toEqual([{ kind: 'same', text: 'same text' }]);
    expect(result.addedWords + result.removedWords).toBe(0);
  });

  it('rebuilds both texts from its segments', () => {
    const before = 'Hook: ask a question.\nBody: three tips.\nCTA: follow.';
    const after = 'Hook: state a bold claim.\nBody: three tips, one example.\nCTA: follow for more.';
    const { segments } = diffText(before, after);
    const rebuild = (skip: 'added' | 'removed'): string =>
      segments
        .filter((segment) => segment.kind !== skip)
        .map((segment) => segment.text)
        .join('');
    expect(rebuild('added')).toBe(before);
    expect(rebuild('removed')).toBe(after);
  });

  it('falls back to a line diff when the word table would exceed the cell budget', () => {
    const before = 'alpha beta gamma\nunchanged line\n';
    const after = 'one two three\nunchanged line\n';
    const result = diffText(before, after, 6);
    expect(result.granularity).toBe('line');
    expect(result.segments).toEqual([
      { kind: 'removed', text: 'alpha beta gamma\n' },
      { kind: 'added', text: 'one two three\n' },
      { kind: 'same', text: 'unchanged line\n' },
    ]);
  });

  it('falls back to whole blocks when even the line table exceeds the budget', () => {
    const result = diffText('a\nb\nc', 'x\ny\nz', 4);
    expect(result.granularity).toBe('block');
    expect(result.segments).toEqual([
      { kind: 'removed', text: 'a\nb\nc' },
      { kind: 'added', text: 'x\ny\nz' },
    ]);
    expect(result.removedWords).toBe(3);
    expect(result.addedWords).toBe(3);
  });

  it('diffs two maximum-length prompts without throwing', () => {
    const words = Array.from({ length: 3000 }, (_, index) => `w${index}`);
    const before = words.join(' ');
    const after = words.map((word, index) => (index % 7 === 0 ? `${word}x` : word)).join(' ');
    const result = diffText(before, after);
    expect(result.granularity).not.toBe('word');
    expect(result.segments.length).toBeGreaterThan(0);
  });
});
