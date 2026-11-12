import { afterEach, describe, expect, it, vi } from 'vitest';
import { postUrlFor } from '../post-url';

describe('postUrlFor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the absolute post detail link from the public app URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');
    expect(postUrlFor('slot-1')).toBe('https://post-engineer.com/posts/slot-1');
  });

  it('trims trailing slashes from the public app URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com///');
    expect(postUrlFor('slot-1')).toBe('https://post-engineer.com/posts/slot-1');
  });

  it('returns null when the public app URL is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
    expect(postUrlFor('slot-1')).toBeNull();
  });

  it('returns null when the public app URL is blank', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '   ');
    expect(postUrlFor('slot-1')).toBeNull();
  });
});
