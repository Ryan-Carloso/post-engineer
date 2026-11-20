import { describe, expect, it } from 'vitest';

import { createWarnOnce } from '../warn-once';

function clock(start: number): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('createWarnOnce', () => {
  it('lets the first sighting of a key through and silences the repeats', () => {
    const time = clock(0);
    const shouldWarn = createWarnOnce({ windowMs: 1000, maxKeys: 10, now: time.now });
    expect(shouldWarn('a')).toBe(true);
    expect(shouldWarn('a')).toBe(false);
    time.advance(999);
    expect(shouldWarn('a')).toBe(false);
  });

  it('tracks each key on its own', () => {
    const shouldWarn = createWarnOnce({ windowMs: 1000, maxKeys: 10, now: () => 0 });
    expect(shouldWarn('a')).toBe(true);
    expect(shouldWarn('b')).toBe(true);
    expect(shouldWarn('a')).toBe(false);
    expect(shouldWarn('b')).toBe(false);
  });

  it('warns again once the window has passed, then stays quiet for a new window', () => {
    const time = clock(0);
    const shouldWarn = createWarnOnce({ windowMs: 1000, maxKeys: 10, now: time.now });
    expect(shouldWarn('a')).toBe(true);
    time.advance(1000);
    expect(shouldWarn('a')).toBe(true);
    time.advance(500);
    expect(shouldWarn('a')).toBe(false);
  });

  it('never remembers more keys than the cap, forgetting the oldest first', () => {
    const shouldWarn = createWarnOnce({ windowMs: 1000, maxKeys: 2, now: () => 0 });
    expect(shouldWarn('a')).toBe(true);
    expect(shouldWarn('b')).toBe(true);
    expect(shouldWarn('c')).toBe(true);
    expect(shouldWarn('b')).toBe(false);
    expect(shouldWarn('c')).toBe(false);
    expect(shouldWarn('a')).toBe(true);
  });

});
