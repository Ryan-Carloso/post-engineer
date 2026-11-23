import { describe, expect, it } from 'vitest';
import { sameOriginRedirect } from '@/lib/same-origin-redirect';

describe('sameOriginRedirect', () => {
  it('answers 307 with a host-relative Location so the browser keeps its own origin', () => {
    const res = sameOriginRedirect('/posts?tab=week');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/posts?tab=week');
  });

  it('uses the status it is given', () => {
    expect(sameOriginRedirect('/x', 302).status).toBe(302);
  });

  it.each(['https://evil.com/', '//evil.com', '/\\evil.com', 'relative'])(
    'refuses %s, which is not a same-origin path',
    (path: string): void => {
      expect(() => sameOriginRedirect(path)).toThrow('same-origin absolute path');
    },
  );
});
