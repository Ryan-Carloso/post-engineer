import { describe, expect, it } from 'vitest';
import { dictionaries } from '@/lib/i18n';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';

const TRIAL_WORDING = /trial|teste gr[aá]tis|7[- ]days? free|7 dias gr[aá]tis/i;

function collectStrings(node: unknown, path: string, found: Array<{ path: string; text: string }>): void {
  if (typeof node === 'string') {
    found.push({ path, text: node });
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node)) collectStrings(value, `${path}.${key}`, found);
}

describe('user-facing copy of the closed beta', () => {
  it('never mentions a trial in any English or Portuguese dictionary string', () => {
    const found: Array<{ path: string; text: string }> = [];
    collectStrings(dictionaries.en, 'en', found);
    collectStrings(dictionaries.pt, 'pt', found);
    expect(found.length).toBeGreaterThan(500);
    expect(found.filter((entry) => TRIAL_WORDING.test(entry.text)).map((entry) => entry.path)).toEqual([]);
  });

  it('never mentions a trial in an API error message', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(errorMessage(code)).not.toMatch(TRIAL_WORDING);
    }
  });
});
