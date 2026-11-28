import { describe, it, expect } from 'vitest';
import { ApiError, apiErrorFromResponse, getErrorMessage, ImageTooLargeError, parseRetryAfterSeconds } from '../errors.js';

describe('getErrorMessage', () => {
  it('returns the message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error thrown values', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('ImageTooLargeError', () => {
  it('carries the path and size with a message derived from the shared limit', () => {
    const error = new ImageTooLargeError('/tmp/photos/a.jpg', 11 * 1024 * 1024);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ImageTooLargeError');
    expect(error.path).toBe('/tmp/photos/a.jpg');
    expect(error.sizeBytes).toBe(11 * 1024 * 1024);
    expect(error.message).toBe(
      'Image "/tmp/photos/a.jpg" is too large (11534336 bytes; max 10MB).'
    );
  });
});

describe('parseRetryAfterSeconds', () => {
  it('reads a delay in whole seconds', () => {
    expect(parseRetryAfterSeconds('42')).toBe(42);
    expect(parseRetryAfterSeconds(' 7 ')).toBe(7);
    expect(parseRetryAfterSeconds('0')).toBe(0);
  });

  it('returns null for a missing or non-numeric header', () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds('')).toBeNull();
    expect(parseRetryAfterSeconds('-5')).toBeNull();
    expect(parseRetryAfterSeconds('1.5')).toBeNull();
    expect(parseRetryAfterSeconds('12abc')).toBeNull();
    expect(parseRetryAfterSeconds('abc12')).toBeNull();
    expect(parseRetryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
  });
});

describe('apiErrorFromResponse', () => {
  it('carries the status, body fields and Retry-After of a 429', async () => {
    const response = new Response(
      JSON.stringify({ success: false, error: 'Poll at most once per minute.', errorType: 'RATE_LIMITED' }),
      { status: 429, headers: { 'Retry-After': '37' } },
    );

    const error = await apiErrorFromResponse(response, 'get video status');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(37);
    expect(error.message).toBe('Failed to get video status: 429 Poll at most once per minute.');
  });

  it('leaves retryAfterSeconds null without a Retry-After header', async () => {
    const response = new Response(JSON.stringify({ error: 'gone', code: 'X', field: 'f', delivered: true, postUrl: 'https://p' }), { status: 410 });

    const error = await apiErrorFromResponse(response, 'get video status');

    expect(error.retryAfterSeconds).toBeNull();
    expect(error).toMatchObject({ code: 'X', field: 'f', delivered: true, postUrl: 'https://p', status: 410 });
  });
});

describe('BETA_ACCESS_REQUIRED responses', () => {
  function betaResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify({ success: false, error: 'Your account has not joined the closed beta yet.', code: 'BETA_ACCESS_REQUIRED', ...body }), { status: 402 });
  }

  it('names the contact link the API returns', async () => {
    const error = await apiErrorFromResponse(betaResponse({ contactUrl: 'https://discord.gg/test' }), 'publish existing media');
    expect(error.code).toBe('BETA_ACCESS_REQUIRED');
    expect(error.status).toBe(402);
    expect(error.message).toBe(
      'Failed to publish existing media: 402 This account has not joined the closed beta yet: scheduling and publishing are blocked, reading your data still works. Request access on the Post Engineer Discord: https://discord.gg/test',
    );
  });

  it('drops a contact link that is not https', async () => {
    const error = await apiErrorFromResponse(betaResponse({ contactUrl: 'javascript:alert(1)' }), 'publish existing media');
    expect(error.message).toContain('Request access on the Post Engineer Discord.');
    expect(error.message).not.toContain('javascript');
  });

  it('keeps the API message for any other code', async () => {
    const response = new Response(JSON.stringify({ success: false, error: 'Bad input', code: 'VALIDATION_ERROR', contactUrl: 'https://wa.me/0000000000' }), { status: 400 });
    const error = await apiErrorFromResponse(response, 'publish existing media');
    expect(error.message).toBe('Failed to publish existing media: 400 Bad input');
  });
});

describe('SUBSCRIPTION_INACTIVE responses', () => {
  function inactiveResponse(body: Record<string, unknown>): Response {
    return new Response(
      JSON.stringify({ success: false, error: 'Your subscription is not active.', code: 'SUBSCRIPTION_INACTIVE', ...body }),
      { status: 402 },
    );
  }

  it('says the subscription is inactive, never that the account has not joined the beta', async () => {
    const error = await apiErrorFromResponse(
      inactiveResponse({ contactUrl: 'https://wa.me/0000000000' }),
      'publish existing media',
    );
    expect(error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect(error.message).toContain('The subscription covering this account is not active');
    expect(error.message).not.toContain('closed beta');
    expect(error.message).toContain('https://wa.me/0000000000');
  });

  it('drops a contact link that is not https', async () => {
    const error = await apiErrorFromResponse(
      inactiveResponse({ contactUrl: 'javascript:alert(1)' }),
      'publish existing media',
    );
    expect(error.message).toContain('Contact the Post Engineer team to continue.');
    expect(error.message).not.toContain('javascript');
  });
});
