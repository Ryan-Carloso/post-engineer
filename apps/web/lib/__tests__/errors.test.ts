import { describe, it, expect } from 'vitest';
import {
  TimeoutError,
  ValidationError,
  AuthError,
  UploadError,
  YouTubeApiError,
  InstagramApiError,
  NetworkError,
  DebuggableBaseError,
  DebuggableAuthError,
  DebuggableNetworkError,
  getStatusCode,
  getErrorType,
  getErrorSuggestions,
} from '@/lib/errors';

describe('Error classes', () => {
  it('TimeoutError sets name and timeoutMs', () => {
    const e = new TimeoutError('timeout', 5000);
    expect(e.name).toBe('TimeoutError');
    expect(e.message).toBe('timeout');
    expect(e.timeoutMs).toBe(5000);
  });

  it('ValidationError sets name and optional field', () => {
    const e = new ValidationError('bad', 'title');
    expect(e.name).toBe('ValidationError');
    expect(e.field).toBe('title');

    const e2 = new ValidationError('bad');
    expect(e2.field).toBeUndefined();
  });

  it('AuthError sets name and authType', () => {
    const e = new AuthError('expired', 'token');
    expect(e.name).toBe('AuthError');
    expect(e.authType).toBe('token');
  });

  it('UploadError sets name and uploadStage', () => {
    const e = new UploadError('fail', 'upload');
    expect(e.name).toBe('UploadError');
    expect(e.uploadStage).toBe('upload');
  });

  it('YouTubeApiError sets name, statusCode, youtubeError', () => {
    const inner = new Error('inner');
    const e = new YouTubeApiError('yt fail', 403, inner);
    expect(e.name).toBe('YouTubeApiError');
    expect(e.statusCode).toBe(403);
    expect(e.youtubeError).toBe(inner);
  });

  it('InstagramApiError sets name, statusCode, instagramError', () => {
    const inner = new Error('inner');
    const e = new InstagramApiError('ig fail', 400, inner);
    expect(e.name).toBe('InstagramApiError');
    expect(e.statusCode).toBe(400);
    expect(e.instagramError).toBe(inner);
  });

  it('NetworkError sets name and networkDetails', () => {
    const details = { host: 'api.example.com' };
    const e = new NetworkError('net fail', details);
    expect(e.name).toBe('NetworkError');
    expect(e.networkDetails).toBe(details);
  });
});

describe('Debuggable errors', () => {
  it('DebuggableBaseError sets cause and logId', () => {
    const e = new DebuggableBaseError('err', { cause: 'x', logId: 'L1' });
    expect(e.name).toBe('DebuggableBaseError');
    expect(e.cause).toBe('x');
    expect(e.logId).toBe('L1');
  });

  it('DebuggableBaseError without options', () => {
    const e = new DebuggableBaseError('err');
    expect(e.cause).toBeUndefined();
    expect(e.logId).toBeUndefined();
  });

  it('DebuggableAuthError sets cause and logId', () => {
    const e = new DebuggableAuthError('auth', 'token', { cause: 'c', logId: 'L2' });
    expect(e.name).toBe('DebuggableAuthError');
    expect(e.authType).toBe('token');
    expect(e.cause).toBe('c');
    expect(e.logId).toBe('L2');
  });

  it('DebuggableNetworkError sets cause and logId', () => {
    const e = new DebuggableNetworkError('net', { x: 1 }, { cause: 'd', logId: 'L3' });
    expect(e.name).toBe('DebuggableNetworkError');
    expect(e.networkDetails).toEqual({ x: 1 });
    expect(e.cause).toBe('d');
    expect(e.logId).toBe('L3');
  });
});

describe('getStatusCode', () => {
  it('ValidationError → 400', () => expect(getStatusCode(new ValidationError('x'))).toBe(400));
  it('TimeoutError → 408', () => expect(getStatusCode(new TimeoutError('x', 1))).toBe(408));
  it('AuthError → 401', () => expect(getStatusCode(new AuthError('x'))).toBe(401));
  it('YouTubeApiError → statusCode', () => expect(getStatusCode(new YouTubeApiError('x', 403))).toBe(403));
  it('InstagramApiError → statusCode', () => expect(getStatusCode(new InstagramApiError('x', 429))).toBe(429));
  it('NetworkError → 503', () => expect(getStatusCode(new NetworkError('x'))).toBe(503));
  it('UploadError → 500', () => expect(getStatusCode(new UploadError('x', 'upload'))).toBe(500));
  it('plain Error → 500', () => expect(getStatusCode(new Error('x'))).toBe(500));
});

describe('getErrorType', () => {
  it('returns error.name uppercased', () => {
    expect(getErrorType(new ValidationError('x'))).toBe('VALIDATIONERROR');
    expect(getErrorType(new AuthError('x'))).toBe('AUTHERROR');
  });
});

describe('getErrorSuggestions', () => {
  it('ValidationError with field → includes field suggestion', () => {
    const s = getErrorSuggestions(new ValidationError('bad', 'title'));
    expect(s.length).toBeGreaterThan(0);
    expect(s.some((x) => x.includes('title'))).toBe(true);
  });

  it('ValidationError without field', () => {
    const s = getErrorSuggestions(new ValidationError('bad'));
    expect(s.length).toBeGreaterThan(0);
  });

  it('AuthError → includes token suggestion', () => {
    const s = getErrorSuggestions(new AuthError('expired', 'token'));
    expect(s.some((x) => x.toLowerCase().includes('token') || x.toLowerCase().includes('auth'))).toBe(true);
  });

  it('UploadError → stage-specific suggestion', () => {
    const s = getErrorSuggestions(new UploadError('fail', 'validation'));
    expect(s.length).toBeGreaterThan(0);
  });

  it('YouTubeApiError → quota suggestion', () => {
    const s = getErrorSuggestions(new YouTubeApiError('quota', 403));
    expect(s.length).toBeGreaterThan(0);
  });

  it('InstagramApiError → permissions suggestion', () => {
    const s = getErrorSuggestions(new InstagramApiError('perm', 400));
    expect(s.length).toBeGreaterThan(0);
  });

  it('NetworkError → network suggestion', () => {
    const s = getErrorSuggestions(new NetworkError('net'));
    expect(s.length).toBeGreaterThan(0);
  });

  it('plain Error → generic suggestion', () => {
    const s = getErrorSuggestions(new Error('generic'));
    expect(s.length).toBeGreaterThan(0);
  });
});
