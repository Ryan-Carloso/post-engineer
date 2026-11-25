import { describe, expect, it } from 'vitest';
import { authErrorLogFields, isTransientAuthError } from '@/lib/auth-error';

describe('isTransientAuthError', () => {
  it.each([429, 500, 502, 503, 504, 522, 530])('treats status %i as transient', (status) => {
    expect(isTransientAuthError({ name: 'AuthApiError', status })).toBe(true);
  });

  it('treats an AuthRetryableFetchError as transient whatever its status', () => {
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats status %i as permanent', (status) => {
    expect(isTransientAuthError({ name: 'AuthApiError', status })).toBe(false);
  });

  it.each([null, undefined, 'boom', 500, {}, { status: '503' }])(
    'treats %j as permanent',
    (error) => {
      expect(isTransientAuthError(error)).toBe(false);
    },
  );
});

describe('authErrorLogFields', () => {
  it('returns only the name and the status, never the message', () => {
    expect(authErrorLogFields({ name: 'AuthApiError', status: 503, message: 'secret' })).toEqual({
      name: 'AuthApiError',
      status: 503,
    });
  });

  it('falls back to unknown name and null status for non-error values', () => {
    expect(authErrorLogFields(null)).toEqual({ name: 'unknown', status: null });
    expect(authErrorLogFields({})).toEqual({ name: 'unknown', status: null });
  });
});
