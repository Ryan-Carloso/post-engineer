import { describe, expect, it } from 'vitest';
import { deriveTagsFromTitle, truncateChars } from '@/lib/publisher/text';

describe('deriveTagsFromTitle', () => {
  it('keeps the title language: Portuguese, English and Hindi', () => {
    expect(deriveTagsFromTitle('Melhores Praias do Algarve')).toEqual(['melhores', 'praias', 'algarve']);
    expect(deriveTagsFromTitle('Best beaches in Portugal')).toEqual(['best', 'beaches', 'portugal']);
    expect(deriveTagsFromTitle('पोर्टो शहर')).toEqual(['पोर्टो', 'शहर']);
  });

  it('dedupes case-insensitively and strips punctuation', () => {
    expect(deriveTagsFromTitle('Porto, PORTO! porto?')).toEqual(['porto']);
  });

  it('drops digits-only tokens in the strict pass', () => {
    expect(deriveTagsFromTitle('Top 10 beaches 2026')).toEqual(['top', 'beaches']);
  });

  it('caps the number of tags at 8', () => {
    const title = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    expect(deriveTagsFromTitle(title)).toHaveLength(8);
  });

  it('falls back to raw words when the strict pass finds nothing', () => {
    expect(deriveTagsFromTitle('a 1')).toEqual(['a', '1']);
  });

  it('yields no tags for a title without words', () => {
    expect(deriveTagsFromTitle('!!! ???')).toEqual([]);
    expect(deriveTagsFromTitle('')).toEqual([]);
  });
});

describe('truncateChars', () => {
  it('counts code points, never splitting an emoji', () => {
    expect(truncateChars('ab😀cd', 3)).toBe('ab😀');
    expect(truncateChars('abc', 5)).toBe('abc');
  });
});
