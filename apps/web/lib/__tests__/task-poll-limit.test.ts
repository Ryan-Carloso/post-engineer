import { describe, expect, it } from 'vitest';
import { machinePollerId, taskPollCaller } from '@/lib/task-poll-limit';

describe('machinePollerId', () => {
  it('keys an API-key caller by its key id', () => {
    expect(machinePollerId({ userId: 'user-1', isApiKey: true, keyId: 'key-1' })).toBe('api-key:key-1');
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

describe('taskPollCaller', () => {
  it('keeps the key id of an API-key caller', () => {
    expect(taskPollCaller({ userId: 'user-1', isApiKey: true, keyId: 'key-1' })).toEqual({
      userId: 'user-1',
      isApiKey: true,
      keyId: 'key-1',
    });
  });

  it('throws for an API-key caller without a key id', () => {
    expect(() => taskPollCaller({ userId: 'user-1', isApiKey: true })).toThrow(
      'API-key caller without a key id',
    );
  });

  it('keys an OAuth caller by its user', () => {
    expect(taskPollCaller({ userId: 'user-1', isOAuth: true })).toEqual({
      userId: 'user-1',
      isOAuth: true,
    });
  });

  it('passes a browser session caller through', () => {
    expect(taskPollCaller({ userId: 'user-1' })).toEqual({ userId: 'user-1' });
  });
});
