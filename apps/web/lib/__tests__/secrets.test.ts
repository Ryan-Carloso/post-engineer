import { describe, it, expect } from 'vitest';
import { secretsMatch } from '@/lib/secrets';

describe('secretsMatch', () => {
  it('accepts identical secrets', () => {
    expect(secretsMatch('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(secretsMatch('correct-horse-battery-staple', 'correct-horse-battery-staplf')).toBe(false);
  });

  it('rejects a wrong secret of a different length', () => {
    expect(secretsMatch('correct-horse-battery-staple', 'short')).toBe(false);
    expect(secretsMatch('short', 'correct-horse-battery-staple')).toBe(false);
  });

  it('rejects empty secrets', () => {
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch('', 'non-empty')).toBe(false);
  });

  it('is not fooled by prefix matches', () => {
    expect(secretsMatch('secret', 'secret-extended')).toBe(false);
  });
});
