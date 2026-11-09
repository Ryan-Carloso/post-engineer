import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

import { trackApiEvent } from '@/lib/analytics';
import {
  httpStatusOf,
  isUnauthorizedError,
  PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT,
  reportAccountUnauthorized,
} from '../account-unauthorized';

beforeEach(() => {
  vi.mocked(trackApiEvent).mockClear();
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

  it('is false for other Bluesky failures', () => {
    expect(isUnauthorizedError({ name: 'BlueskyError', code: 'upload_failed' })).toBe(false);
    expect(isUnauthorizedError({ name: 'BlueskyError', code: 'rate_limited' })).toBe(false);
  });

  it('is false for other failures', () => {
    expect(isUnauthorizedError(new Error('socket hang up'))).toBe(false);
    expect(isUnauthorizedError({ response: { status: 500 } })).toBe(false);
    expect(isUnauthorizedError(new Error('Unauthorized scope for this app'))).toBe(false);
  });
});

describe('reportAccountUnauthorized', () => {
  it('emits publish_account_unauthorized with ids only for a 401', () => {
    reportAccountUnauthorized('youtube', 'UC123', 'user-1', new Error('Unauthorized'));
    expect(trackApiEvent).toHaveBeenCalledTimes(1);
    expect(trackApiEvent).toHaveBeenCalledWith(PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT, {
      provider: 'youtube',
      account_id: 'UC123',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('emits nothing for a failure that is not a 401', () => {
    reportAccountUnauthorized('instagram', 'ig-1', 'user-1', { response: { status: 500 } });
    expect(trackApiEvent).not.toHaveBeenCalled();
  });
});
