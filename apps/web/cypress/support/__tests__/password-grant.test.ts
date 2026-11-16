import { describe, expect, it } from 'vitest';

import {
  PASSWORD_GRANT_BACKOFF_CAP_MS,
  PASSWORD_GRANT_MAX_ATTEMPTS,
  PASSWORD_GRANT_RETRY_AFTER_CAP_MS,
  SESSION_EXPIRY_SKEW_MS,
  decodeSupabaseSessionCookie,
  encodeSupabaseSessionCookie,
  isPasswordGrantSession,
  passwordGrantDelayMs,
  passwordGrantErrorCode,
  passwordGrantStep,
  sessionStillValid,
  singleHeader,
  supabaseAuthCookieName,
} from '../password-grant';

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');

function jwtWithExp(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `e30.${payload}.sig`;
}

describe('password grant retry', () => {
  it('succeeds on HTTP 200 without a delay', () => {
    expect(
      passwordGrantStep({
        status: 200,
        attempt: 1,
        retryAfter: '60',
        nowMs: NOW_MS,
        errorCode: null,
      }),
    ).toEqual({ action: 'succeed' });
  });

  it('retries only HTTP 429, honouring Retry-After seconds', () => {
    expect(
      passwordGrantStep({
        status: 429,
        attempt: 1,
        retryAfter: '2',
        nowMs: NOW_MS,
        errorCode: 'over_request_rate_limit',
      }),
    ).toEqual({ action: 'retry', delayMs: 2000 });
  });

  it('honours a Retry-After HTTP date', () => {
    expect(passwordGrantDelayMs(1, 'Thu, 01 Jan 2026 00:00:05 GMT', NOW_MS)).toBe(5000);
  });

  it('caps a long Retry-After so one 429 cannot stall the run', () => {
    expect(passwordGrantDelayMs(1, '120', NOW_MS)).toBe(PASSWORD_GRANT_RETRY_AFTER_CAP_MS);
  });

  it('uses exponential backoff when Retry-After is missing, and caps it', () => {
    expect(passwordGrantDelayMs(1, null, NOW_MS)).toBe(1000);
    expect(passwordGrantDelayMs(2, '   ', NOW_MS)).toBe(2000);
    expect(passwordGrantDelayMs(1, 'not-a-date', NOW_MS)).toBe(1000);
    expect(passwordGrantDelayMs(8, null, NOW_MS)).toBe(PASSWORD_GRANT_BACKOFF_CAP_MS);
  });

  it('does not retry any status other than 429, even with Retry-After', () => {
    const step = passwordGrantStep({
      status: 401,
      attempt: 1,
      retryAfter: '1',
      nowMs: NOW_MS,
      errorCode: 'invalid_grant',
    });
    expect(step).toEqual({
      action: 'fail',
      message: 'Supabase password grant failed with HTTP 401 invalid_grant on attempt 1',
    });
  });

  it('fails clearly after the last 429 instead of retrying again', () => {
    const step = passwordGrantStep({
      status: 429,
      attempt: PASSWORD_GRANT_MAX_ATTEMPTS,
      retryAfter: '1',
      nowMs: NOW_MS,
      errorCode: 'over_request_rate_limit',
    });
    expect(step.action).toBe('fail');
    if (step.action === 'fail') {
      expect(step.message).toBe(
        'Supabase password grant was rate limited (HTTP 429 over_request_rate_limit) after 3 attempts',
      );
    }
  });

  it('reads the Supabase error_code and ignores free-text bodies', () => {
    expect(passwordGrantErrorCode({ error_code: 'over_request_rate_limit', msg: 'slow down' })).toBe(
      'over_request_rate_limit',
    );
    expect(passwordGrantErrorCode({ error: 'invalid_grant' })).toBe('invalid_grant');
    expect(passwordGrantErrorCode({ msg: 'email user@example.com is locked' })).toBeNull();
    expect(passwordGrantErrorCode('nope')).toBeNull();
  });

  it('reads a single Retry-After header value', () => {
    expect(singleHeader('2')).toBe('2');
    expect(singleHeader(['3', '4'])).toBe('3');
    expect(singleHeader(undefined)).toBeNull();
    expect(singleHeader(1)).toBeNull();
  });
});

describe('supabase session cookie', () => {
  const session = {
    access_token: 'abc+/=',
    expires_at: 4_000_000_000,
    user: { email: 'a@b.c' },
  };

  it('encodes the session the same way the command always has', () => {
    expect(encodeSupabaseSessionCookie(session)).toBe(
      'base64-eyJhY2Nlc3NfdG9rZW4iOiJhYmMrLz0iLCJleHBpcmVzX2F0Ijo0MDAwMDAwMDAwLCJ1c2VyIjp7ImVtYWlsIjoiYUBiLmMifX0',
    );
  });

  it('round-trips the cookie back to the session object', () => {
    expect(decodeSupabaseSessionCookie(encodeSupabaseSessionCookie(session))).toEqual(session);
  });

  it('names the cookie from the project ref in the Supabase URL', () => {
    expect(supabaseAuthCookieName('https://abcdefgh.supabase.co')).toBe('sb-abcdefgh-auth-token');
  });

  it('accepts a session only when it carries an access token', () => {
    expect(isPasswordGrantSession(session)).toBe(true);
    expect(isPasswordGrantSession({ access_token: '' })).toBe(false);
    expect(isPasswordGrantSession({ expires_at: 1 })).toBe(false);
  });

  it('treats expires_at seconds as valid only past the skew window', () => {
    const expiresAtSeconds = (NOW_MS + SESSION_EXPIRY_SKEW_MS) / 1000;
    expect(sessionStillValid({ access_token: 'token', expires_at: expiresAtSeconds }, NOW_MS)).toBe(false);
    expect(
      sessionStillValid({ access_token: 'token', expires_at: expiresAtSeconds + 1 }, NOW_MS),
    ).toBe(true);
  });

  it('falls back to the access token exp when expires_at is absent', () => {
    const future = Math.floor((NOW_MS + SESSION_EXPIRY_SKEW_MS) / 1000) + 1;
    const past = Math.floor(NOW_MS / 1000) - 10;
    expect(sessionStillValid({ access_token: jwtWithExp(future) }, NOW_MS)).toBe(true);
    expect(sessionStillValid({ access_token: jwtWithExp(past) }, NOW_MS)).toBe(false);
    expect(sessionStillValid({ access_token: 'not-a-jwt' }, NOW_MS)).toBe(false);
  });

  it('trusts expires_at over a contradictory token exp', () => {
    const past = Math.floor(NOW_MS / 1000) - 10;
    expect(
      sessionStillValid(
        { access_token: jwtWithExp(past), expires_at: 4_000_000_000 },
        NOW_MS,
      ),
    ).toBe(true);
  });
});
