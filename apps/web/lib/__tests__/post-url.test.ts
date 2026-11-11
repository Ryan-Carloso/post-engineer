import { describe, expect, it } from 'vitest';
import { postUrlFor } from '../post-url';

describe('postUrlFor', () => {
  it('builds the absolute post detail link', () => {
    expect(postUrlFor('https://post-engineer.com', 'slot-1')).toBe(
      'https://post-engineer.com/posts/slot-1',
    );
  });
});
