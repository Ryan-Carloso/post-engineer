import { describe, expect, it } from 'vitest';
import { interpretResult, targetsFromResults } from '@/lib/publisher/account-results';

describe('interpretResult', () => {
  it('a success or any link is published', () => {
    expect(interpretResult({ success: true, videoUrl: 'u' }).kind).toBe('published');
    expect(interpretResult({ permalink: 'https://x' }).kind).toBe('published');
  });

  it('an explicit failure wins over a link', () => {
    expect(interpretResult({ success: false, postId: 'p' }).kind).toBe('failed');
  });

  it('a failure carries the message and the error code', () => {
    expect(interpretResult({ success: false, error: 'nope', errorCode: 'token_expired' })).toEqual({
      kind: 'failed',
      source: { error: 'nope', errorCode: 'token_expired' },
    });
    expect(interpretResult({ success: false })).toEqual({
      kind: 'failed',
      source: { error: 'upload API reported account failure', errorCode: null },
    });
  });
});

describe('targetsFromResults', () => {
  it('fails every pending account when there are no results', () => {
    for (const body of [undefined, [], [7, 'x']]) {
      const targets = targetsFromResults(['a', 'b'], body);
      expect([...targets.values()].map((target) => target.kind)).toEqual(['failed', 'failed']);
    }
  });

  it('matches labeled results to their accounts', () => {
    const targets = targetsFromResults(['a', 'b'], [
      { accountId: 'a', success: true, videoUrl: 'u' },
      { accountId: 'b', success: false, error: 'x', errorCode: 'transient' },
    ]);
    expect(targets.get('a')?.kind).toBe('published');
    expect(targets.get('b')).toEqual({ kind: 'failed', source: { error: 'x', errorCode: 'transient' } });
  });

  it('an unlabeled failure applies to every pending account', () => {
    const targets = targetsFromResults(['a', 'b'], [{ accountId: '', success: false, error: 'rejected', errorCode: 'publish_rejected' }]);
    expect(targets.get('a')?.source.errorCode).toBe('publish_rejected');
    expect(targets.get('b')?.source.errorCode).toBe('publish_rejected');
  });

  it('an unlabeled success is not spread over several accounts', () => {
    const targets = targetsFromResults(['a', 'b'], [{ accountId: '', success: true, videoUrl: 'u' }]);
    expect(targets.get('a')?.kind).toBe('failed');
    expect(targets.get('b')?.kind).toBe('failed');
  });

  it('labeled results win over the unlabeled one', () => {
    const targets = targetsFromResults(['a', 'b'], [
      { accountId: '', success: false, error: 'shared' },
      { accountId: 'a', success: true, videoUrl: 'u' },
    ]);
    expect(targets.get('a')?.kind).toBe('published');
    expect(targets.get('b')?.source.error).toBe('shared');
  });

  it('a single result for a single account is that account even when its id differs', () => {
    const targets = targetsFromResults(['a'], [{ accountId: 'other', success: true, videoUrl: 'u' }]);
    expect(targets.get('a')?.kind).toBe('published');
  });

  it('an account with no result fails with the default message', () => {
    const targets = targetsFromResults(['a', 'b'], [
      { accountId: 'a', success: true, videoUrl: 'u' },
      { accountId: 'c', success: true, videoUrl: 'u' },
    ]);
    expect(targets.get('b')).toEqual({ kind: 'failed', source: { error: 'upload API reported account failure', errorCode: null } });
  });

  it('the placeholder account takes a lone result as is', () => {
    expect(targetsFromResults([''], [{ accountId: '', success: false, error: 'At least one account', errorCode: 'publish_rejected' }]).get('')).toEqual({
      kind: 'failed',
      source: { error: 'At least one account', errorCode: 'publish_rejected' },
    });
  });

  it('the placeholder account is published when any result succeeded and failed with the first error otherwise', () => {
    expect(
      targetsFromResults([''], [
        { accountId: 'a', success: false, error: 'x' },
        { accountId: 'b', success: true, videoUrl: 'u' },
      ]).get('')?.kind,
    ).toBe('published');
    expect(
      targetsFromResults([''], [
        { accountId: 'a', success: false, error: 'first', errorCode: 'token_expired' },
        { accountId: 'b', success: false, error: 'second' },
      ]).get(''),
    ).toEqual({ kind: 'failed', source: { error: 'first', errorCode: 'token_expired' } });
  });
});
