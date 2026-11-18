import { describe, it, expect } from 'vitest';

import { readMetaErrorCode, readMetaErrorSubcode } from '@/lib/meta-error-code';

describe('readMetaErrorCode / readMetaErrorSubcode', () => {
  const metaBody = {
    error: {
      message:
        'Unsupported get request. Object with ID \'123\' does not exist, cannot be loaded due to missing permissions, or does not support this operation.',
      type: 'RestException',
      code: 100,
      error_subcode: 33,
      fbtrace_id: 'trace-1',
    },
  };

  it('reads code and error_subcode from the Meta envelope', () => {
    expect(readMetaErrorCode(metaBody)).toBe(100);
    expect(readMetaErrorSubcode(metaBody)).toBe(33);
  });

  it('reads a dead-token envelope (code 190, no subcode)', () => {
    const body = {
      error: {
        message: 'Error validating access token',
        type: 'OAuthException',
        code: 190,
        fbtrace_id: 'trace-2',
      },
    };
    expect(readMetaErrorCode(body)).toBe(190);
    expect(readMetaErrorSubcode(body)).toBeUndefined();
  });

  it('returns undefined for non-envelope bodies and non-numeric fields', () => {
    expect(readMetaErrorCode(null)).toBeUndefined();
    expect(readMetaErrorSubcode(null)).toBeUndefined();
    expect(readMetaErrorCode({ error: 'string' })).toBeUndefined();
    expect(readMetaErrorSubcode({ error: 'string' })).toBeUndefined();
    expect(readMetaErrorCode({ error: { code: '100' } })).toBeUndefined();
    expect(readMetaErrorSubcode({ error: { error_subcode: '33' } })).toBeUndefined();
    expect(readMetaErrorCode({})).toBeUndefined();
    expect(readMetaErrorSubcode({})).toBeUndefined();
  });
});
