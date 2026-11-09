import { describe, expect, it } from 'vitest';
import { BlueskyError } from '@/lib/bluesky';
import { AccountNotFoundError, AuthError } from '@/lib/errors';
import { accountFailure, classifyUploadAccountError } from '@/lib/upload/account-error';

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { response: { status } });
}

describe('classifyUploadAccountError', () => {
  it('keeps the Bluesky email code', () => {
    expect(classifyUploadAccountError(new BlueskyError('email_not_verified', 'Bluesky email is not verified.'))).toEqual({
      error: 'Bluesky email is not verified.',
      errorCode: 'email_not_verified',
    });
  });

  it('maps other typed Bluesky codes', () => {
    expect(classifyUploadAccountError(new BlueskyError('invalid_credentials', 'bad app password')).errorCode).toBe('token_expired');
    expect(classifyUploadAccountError(new BlueskyError('rate_limited', 'slow down')).errorCode).toBe('transient');
    expect(classifyUploadAccountError(new BlueskyError('post_failed', 'boom')).errorCode).toBe('transient');
  });

  it('maps a removed account and auth errors to user codes', () => {
    expect(classifyUploadAccountError(new AccountNotFoundError('Social account not found for threads/x')).errorCode).toBe('disconnected');
    expect(classifyUploadAccountError(new AuthError('Account x not found', 'account_not_found')).errorCode).toBe('disconnected');
    expect(classifyUploadAccountError(new AuthError('Failed to load account token', 'invalid_token')).errorCode).toBe('token_expired');
  });

  it('classifies by HTTP status, never by the message text', () => {
    expect(classifyUploadAccountError(httpError('Media ID not found', 400)).errorCode).toBe('publish_rejected');
    expect(classifyUploadAccountError(httpError('credential service unavailable', 503)).errorCode).toBe('transient');
    expect(classifyUploadAccountError(httpError('upload URL expired', 429)).errorCode).toBe('transient');
    expect(classifyUploadAccountError(httpError('Unauthorized', 401)).errorCode).toBe('token_expired');
    expect(classifyUploadAccountError(httpError('Forbidden', 403)).errorCode).toBe('publish_rejected');
    expect(classifyUploadAccountError(httpError('odd', 302)).errorCode).toBe('transient');
  });

  it('treats a network error or unknown throw as transient', () => {
    expect(classifyUploadAccountError(new TypeError('fetch failed'))).toEqual({ error: 'fetch failed', errorCode: 'transient' });
    expect(classifyUploadAccountError('account disconnected').errorCode).toBe('transient');
    expect(classifyUploadAccountError(42)).toEqual({ error: 'Unknown error', errorCode: 'transient' });
  });

  it('lets the handler pass the code it already knows', () => {
    expect(accountFailure('b1', 'Bluesky credential not found', 'token_missing')).toEqual({
      accountId: 'b1',
      success: false,
      error: 'Bluesky credential not found',
      errorCode: 'token_missing',
    });
    expect(accountFailure('', 'Caption is required', 'publish_rejected').errorCode).toBe('publish_rejected');
  });
});
