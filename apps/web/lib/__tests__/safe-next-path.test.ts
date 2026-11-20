import { describe, expect, it } from 'vitest';
import { isSafeNextPath, safeNextPath } from '@/lib/safe-next-path';

describe('isSafeNextPath', () => {
  it.each(['/', '/dashboard', '/videos?page=2', '/settings/profile#tab'])('accepts %s', (value) => {
    expect(isSafeNextPath(value)).toBe(true);
  });

  it.each<[string | null, string]>([
    [null, 'missing'],
    ['', 'empty'],
    ['dashboard', 'no leading slash'],
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash after the slash'],
    ['/dashboard\\evil.com', 'backslash later in the path'],
    ['https://evil.com', 'absolute URL'],
    ['javascript:alert(1)', 'javascript scheme'],
  ])('rejects %s (%s)', (value) => {
    expect(isSafeNextPath(value)).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('returns the value when it is safe', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
  });

  it('falls back to / when it is not', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
