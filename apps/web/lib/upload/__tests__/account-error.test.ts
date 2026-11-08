import { describe, expect, it } from 'vitest';
import { BlueskyError } from '@/lib/bluesky';
import { accountFailure, classifyUploadAccountError } from '@/lib/upload/account-error';

describe('classifyUploadAccountError', () => {
  it('keeps the Bluesky email code and does not treat "invalid" as disconnected', () => {
    expect(classifyUploadAccountError(new BlueskyError('email_not_verified', 'Bluesky email is not verified.'))).toEqual({
      error: 'Bluesky email is not verified.',
      errorCode: 'email_not_verified',
    });
    expect(classifyUploadAccountError('Invalid caption')).toEqual({
      error: 'Invalid caption',
      errorCode: 'publish_rejected',
    });
  });

  it('maps missing, expired, and disconnected accounts to user-action codes', () => {
    expect(accountFailure('b1', 'Bluesky credential not found')).toMatchObject({
      accountId: 'b1',
      success: false,
      errorCode: 'token_missing',
    });
    expect(accountFailure('ig1', 'Instagram token expired. Please reconnect the account.')).toMatchObject({
      errorCode: 'token_expired',
    });
    expect(accountFailure('th1', 'account disconnected')).toMatchObject({ errorCode: 'disconnected' });
  });
});
