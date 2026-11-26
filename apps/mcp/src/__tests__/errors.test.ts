import { describe, it, expect } from 'vitest';
import { ApiError, apiErrorFromResponse, getErrorMessage, ImageTooLargeError, parseRetryAfterSeconds, readApiFailure } from '../errors.js';

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

describe('readApiFailure', () => {
  it('returns the engine reason and prefixes the detail with it', () => {
    const failure = readApiFailure(
      JSON.stringify({ success: false, error: 'The video service rejected the request.', code: 'ENGINE_REJECTED', reason: "video_type: unknown video_type 'voiceover'" }),
    );
    expect(failure.reason).toBe("video_type: unknown video_type 'voiceover'");
    expect(failure.detail).toBe("video_type: unknown video_type 'voiceover' — The video service rejected the request.");
    expect(failure.code).toBe('ENGINE_REJECTED');
  });

  it('caps a long reason at 200 chars', () => {
    const failure = readApiFailure(JSON.stringify({ success: false, error: 'Rejected.', reason: 'r'.repeat(250) }));
    expect(failure.reason).toHaveLength(200);
    expect(failure.detail).toHaveLength(200);
  });

  it('returns null reason and the plain detail when the body has no reason', () => {
    const failure = readApiFailure(JSON.stringify({ success: false, error: 'Poll at most once per minute.' }));
    expect(failure.reason).toBeNull();
    expect(failure.detail).toBe('Poll at most once per minute.');
  });

  it('returns null reason for a non-string reason', () => {
    const failure = readApiFailure(JSON.stringify({ success: false, error: 'Rejected.', reason: 42 }));
    expect(failure.reason).toBeNull();
    expect(failure.detail).toBe('Rejected.');
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

  it('carries the engine reason on a 400 ENGINE_REJECTED', async () => {
    const response = new Response(
      JSON.stringify({ success: false, error: 'The video service rejected the request.', code: 'ENGINE_REJECTED', reason: "video_type: unknown video_type 'voiceover'" }),
      { status: 400 },
    );

    const error = await apiErrorFromResponse(response, 'generate video');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('ENGINE_REJECTED');
    expect(error.reason).toBe("video_type: unknown video_type 'voiceover'");
    expect(error.message).toBe("Failed to generate video: 400 video_type: unknown video_type 'voiceover' — The video service rejected the request.");
  });

  it('leaves reason null when the body has none', async () => {
    const response = new Response(JSON.stringify({ error: 'gone', code: 'X' }), { status: 410 });

    const error = await apiErrorFromResponse(response, 'get video status');

    expect(error.reason).toBeNull();
    expect(error.message).toBe('Failed to get video status: 410 gone');
  });
});
