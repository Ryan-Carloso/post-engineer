import { describe, it, expect } from 'vitest';

import { sanitizeClientName } from '@/lib/oauth/client-name';

describe('sanitizeClientName', () => {
  it('returns plain names unchanged', () => {
    expect(sanitizeClientName('My Agent')).toBe('My Agent');
  });

  it('normalizes Unicode (NFC)', () => {
    // "é" as e + combining acute must equal the precomposed form.
    expect(sanitizeClientName('Cafe\u0301')).toBe('Café');
  });

  it('strips bidirectional override characters', () => {
    expect(sanitizeClientName('Good\u202Eevil')).toBe('Goodevil');
    expect(sanitizeClientName('\u2066Bad\u2069')).toBe('Bad');
  });

  it('strips control characters and zero-width joiners/spaces', () => {
    expect(sanitizeClientName('a\u200Bb\u200Cc\u200Dd\uFEFFe')).toBe('abcde');
    expect(sanitizeClientName('a\u0007b\u001Bc')).toBe('abc');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeClientName('  My\n\t Agent  ')).toBe('My Agent');
  });

  it('truncates long names to a safe length', () => {
    const long = 'A'.repeat(200);
    const out = sanitizeClientName(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to a generic label when nothing displayable remains', () => {
    expect(sanitizeClientName('\u202E\u200B')).toBe('this application');
    expect(sanitizeClientName('')).toBe('this application');
  });

  it('handles null/undefined safely', () => {
    expect(sanitizeClientName(null)).toBe('this application');
    expect(sanitizeClientName(undefined)).toBe('this application');
  });

  it('accepts a custom fallback label', () => {
    expect(sanitizeClientName(null, 'custom app')).toBe('custom app');
    expect(sanitizeClientName('\u200B', 'custom app')).toBe('custom app');
  });

  it('safely truncates names containing astral / surrogate-pair characters without splitting code points', () => {
    // 78 ascii chars + 5 astral emoji (2 UTF-16 code units each)
    const emojiName = 'A'.repeat(78) + '🚀🎉🔥🌟✨';
    const out = sanitizeClientName(emojiName);
    const codePoints = Array.from(out);
    expect(codePoints.length).toBe(80);
    expect(out.endsWith('…')).toBe(true);
    // Ensure no lone/unpaired surrogates in output
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
  });
});
