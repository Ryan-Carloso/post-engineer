import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/owner-alert-mail', () => ({ notifyAccountBreak: vi.fn(() => Promise.resolve()) }));

import { trackApiEvent } from '@/lib/analytics';
import { FacebookError, InstagramApiError, ThreadsError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { notifyAccountBreak } from '@/lib/owner-alert-mail';
import {
  httpStatusOf,
  isUnauthorizedError,
  PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT,
  reportAccountUnauthorized,
} from '../account-unauthorized';

beforeEach(() => {
  vi.mocked(trackApiEvent).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(notifyAccountBreak).mockClear();
});

describe('httpStatusOf', () => {
  it('reads an axios-style response.status', () => {
    expect(httpStatusOf({ response: { status: 403 } })).toBe(403);
  });

  it('reads a Google/gaxios numeric code', () => {
    expect(httpStatusOf({ code: 401 })).toBe(401);
  });

  it('reads a top-level status', () => {
    expect(httpStatusOf({ status: 502 })).toBe(502);
  });

  it('reads a statusCode (InstagramApiError)', () => {
    expect(httpStatusOf({ statusCode: 401 })).toBe(401);
  });

  it('reads the HTTP status, never the Meta provider code, on a 190 error', () => {
    expect(httpStatusOf(new InstagramApiError('Error validating access token', 400, undefined, 190))).toBe(400);
    expect(httpStatusOf(new FacebookError('Error validating access token', 400, 190))).toBe(400);
    expect(httpStatusOf(new ThreadsError('Error validating access token', 400, 190))).toBe(400);
  });

  it('ignores non-numeric codes and non-objects', () => {
    expect(httpStatusOf({ code: 'ECONNRESET' })).toBeUndefined();
    expect(httpStatusOf('Unauthorized')).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
  });
});

describe('isUnauthorizedError', () => {
  it('is true for a 401 status in any shape', () => {
    expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true);
    expect(isUnauthorizedError({ code: 401 })).toBe(true);
  });

  it('is true for the bare Unauthorized message Google returns', () => {
    expect(isUnauthorizedError(new Error('Unauthorized'))).toBe(true);
  });

  it('is true for a dead Bluesky credential (invalid_credentials, no numeric status)', () => {
    expect(isUnauthorizedError({ name: 'BlueskyError', code: 'invalid_credentials' })).toBe(true);
  });

  it('is true for a dead Rumble token (invalid_token, no numeric status)', () => {
    expect(isUnauthorizedError({ name: 'RumbleError', code: 'invalid_token' })).toBe(true);
  });

  it('is false for other Rumble failures', () => {
    expect(isUnauthorizedError({ name: 'RumbleError', code: 'upload_failed' })).toBe(false);
    expect(isUnauthorizedError({ name: 'RumbleError', code: 'unknown' })).toBe(false);
  });

  it('is false for other Bluesky failures', () => {
    expect(isUnauthorizedError({ name: 'BlueskyError', code: 'upload_failed' })).toBe(false);
    expect(isUnauthorizedError({ name: 'BlueskyError', code: 'rate_limited' })).toBe(false);
  });

  it('is true for a dead Meta token (HTTP 400 + OAuthException code 190, never a 401)', () => {
    const message =
      'Error validating access token: The session has been invalidated because the user changed their password.';
    expect(isUnauthorizedError(new InstagramApiError(message, 400, undefined, 190))).toBe(true);
    expect(isUnauthorizedError(new FacebookError(message, 400, 190))).toBe(true);
    expect(isUnauthorizedError(new ThreadsError(message, 400, 190))).toBe(true);
  });

  it('is false for other Meta provider codes', () => {
    expect(isUnauthorizedError(new InstagramApiError('bad request', 400, undefined, 100))).toBe(false);
    expect(isUnauthorizedError(new FacebookError('bad request', 400, 191))).toBe(false);
    expect(isUnauthorizedError(new ThreadsError('bad request', 400, 200))).toBe(false);
  });

  it('is false for a Meta 400 without a provider code', () => {
    expect(isUnauthorizedError(new InstagramApiError('Media ID not found', 400))).toBe(false);
    expect(isUnauthorizedError(new FacebookError('no permission', 403))).toBe(false);
  });

  it('is false for other failures', () => {
    expect(isUnauthorizedError(new Error('socket hang up'))).toBe(false);
    expect(isUnauthorizedError({ response: { status: 500 } })).toBe(false);
    expect(isUnauthorizedError(new Error('Unauthorized scope for this app'))).toBe(false);
  });
});

describe('reportAccountUnauthorized', () => {
  it('emits publish_account_unauthorized with ids only for a 401', () => {
    const error = new Error('Unauthorized');
    reportAccountUnauthorized('youtube', 'UC123', 'user-1', error);
    expect(trackApiEvent).toHaveBeenCalledTimes(1);
    expect(trackApiEvent).toHaveBeenCalledWith(PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT, {
      provider: 'youtube',
      account_id: 'UC123',
      user_id: 'user-1',
      status: 401,
    });
    expect(notifyAccountBreak).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'youtube',
      accountId: 'UC123',
      error,
    });
  });

  it('emits publish_account_unauthorized with the HTTP status for a Meta 190 dead token', () => {
    const error = new InstagramApiError('Error validating access token', 400, undefined, 190);
    reportAccountUnauthorized('instagram', 'ig-1', 'user-1', error);
    expect(trackApiEvent).toHaveBeenCalledTimes(1);
    expect(trackApiEvent).toHaveBeenCalledWith(PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT, {
      provider: 'instagram',
      account_id: 'ig-1',
      user_id: 'user-1',
      status: 400,
    });
    expect(notifyAccountBreak).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'instagram',
      accountId: 'ig-1',
      error,
    });
  });

  it('emits nothing for a failure that is not a 401', () => {
    reportAccountUnauthorized('instagram', 'ig-1', 'user-1', { response: { status: 500 } });
    expect(trackApiEvent).not.toHaveBeenCalled();
    expect(notifyAccountBreak).not.toHaveBeenCalled();
  });

  it('emails email_not_verified without the unauthorized PostHog event', () => {
    const error = { name: 'BlueskyError', code: 'email_not_verified' };
    reportAccountUnauthorized('bluesky', 'did:plc:1', 'user-1', error);
    expect(trackApiEvent).not.toHaveBeenCalled();
    expect(notifyAccountBreak).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'bluesky',
      accountId: 'did:plc:1',
      error,
    });
  });

  it('logs when the owner email fails', async () => {
    vi.mocked(notifyAccountBreak).mockRejectedValueOnce('boom');
    reportAccountUnauthorized('youtube', 'UC123', 'user-1', new Error('Unauthorized'));
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('[ACCOUNT] Owner alert failed', expect.any(Error));
    });
  });
});
