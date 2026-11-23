import { describe, expect, it } from 'vitest';
import { machinePollerId } from '@/lib/task-poll-limit';

describe('machinePollerId', () => {
  it('keys an API-key caller by its key id', () => {
    expect(machinePollerId({ userId: 'user-1', isApiKey: true, keyId: 'key-1' })).toBe('api-key:key-1');
  });

  it('keys an API-key caller without a key id by its user', () => {
    expect(machinePollerId({ userId: 'user-1', isApiKey: true })).toBe('api-key-user:user-1');
  });

  it('keys an OAuth caller by its user', () => {
    expect(machinePollerId({ userId: 'user-1', isOAuth: true })).toBe('oauth:user-1');
  });

  it('returns null for a browser session caller', () => {
    expect(machinePollerId({ userId: 'user-1' })).toBeNull();
  });

  it('returns null when the flags are explicitly false', () => {
    expect(machinePollerId({ userId: 'user-1', isApiKey: false, isOAuth: false, keyId: 'key-1' })).toBeNull();
  });
});
