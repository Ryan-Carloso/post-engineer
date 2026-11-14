import { describe, it, expect } from 'vitest';
import { requireApiKey } from '../require-api-key.js';

describe('requireApiKey', () => {
  it('throws when POST_ENGINEER_API_KEY is missing', () => {
    expect(() => requireApiKey({})).toThrow('POST_ENGINEER_API_KEY is required');
  });

  it('returns the key when set', () => {
    expect(requireApiKey({ POST_ENGINEER_API_KEY: 'k' })).toBe('k');
  });
});
