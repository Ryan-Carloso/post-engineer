import { describe, expect, it } from 'vitest';
import { classifyAccountBreak } from '@/lib/account-break';

describe('classifyAccountBreak', () => {
  it('treats a short GCM tag as an undecryptable token', () => {
    expect(classifyAccountBreak(new Error('Invalid authentication tag length: 2'))).toBe('token_undecryptable');
  });

  it('treats TokenDecryptError and the other decrypt failures as undecryptable', () => {
    const wrapped = new Error('Unsupported state or unable to authenticate data');
    wrapped.name = 'TokenDecryptError';
    expect(classifyAccountBreak(wrapped)).toBe('token_undecryptable');
    expect(classifyAccountBreak(new Error('Invalid encrypted token format or version'))).toBe('token_undecryptable');
    expect(classifyAccountBreak(new Error('Decrypted payload is not an object'))).toBe('token_undecryptable');
  });

  it('treats a 401 and a dead provider credential as unauthorized', () => {
    expect(classifyAccountBreak({ response: { status: 401 } })).toBe('unauthorized');
    expect(classifyAccountBreak(new Error('Unauthorized'))).toBe('unauthorized');
    expect(classifyAccountBreak({ name: 'BlueskyError', code: 'invalid_credentials' })).toBe('unauthorized');
    expect(classifyAccountBreak({ name: 'RumbleError', code: 'invalid_token' })).toBe('unauthorized');
  });

  it('treats Bluesky email_not_verified as its own class', () => {
    expect(classifyAccountBreak({ name: 'BlueskyError', code: 'email_not_verified' })).toBe('email_not_verified');
  });

  it('does not email a server key misconfiguration', () => {
    expect(classifyAccountBreak(new Error('TOKEN_ENCRYPTION_KEY is not defined'))).toBeNull();
    expect(classifyAccountBreak(new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)'))).toBeNull();
    const wrapped = new Error('TOKEN_ENCRYPTION_KEY is not defined');
    wrapped.name = 'TokenDecryptError';
    expect(classifyAccountBreak(wrapped)).toBeNull();
  });

  it('ignores 403, 500, and ordinary failures', () => {
    expect(classifyAccountBreak({ response: { status: 403 } })).toBeNull();
    expect(classifyAccountBreak({ response: { status: 500 } })).toBeNull();
    expect(classifyAccountBreak(new Error('socket hang up'))).toBeNull();
    expect(classifyAccountBreak(new Error('token revoked'))).toBeNull();
    expect(classifyAccountBreak(new Error('YOUTUBE_CHANNEL_NOT_FOUND'))).toBeNull();
  });
});
