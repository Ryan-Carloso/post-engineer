import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '@/lib/logger';
import { getPostHogServer } from '@/lib/posthog-server';

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

//---------------
// logger — core and specialized methods
//---------------

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateLogId returns an id with date and time', () => {
    const id = logger.generateLogId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[a-z0-9]+$/);
  });

  it('info logs and returns a logId', () => {
    const id = logger.info('hello', { endpoint: '/api/x', method: 'POST' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(console.log).toHaveBeenCalled();
  });

  it('warn uses console.warn and debug uses console.log', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('warning');
    logger.debug('detalhe');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('error uses console.error and includes the stack when available', () => {
    const err = new Error('falhou');
    logger.error('erro', err, { endpoint: '/api/upload' });
    expect(console.error).toHaveBeenCalled();
  });

  it('logUploadStart / Progress / Success use console.log', () => {
    const logId = '2026_101010_abc123';
    logger.logUploadStart(logId, { provider: 'youtube' });
    logger.logUploadProgress(logId, { uploadedBytes: 1, totalBytes: 2, percentage: 50 });
    logger.logUploadSuccess(logId, { videoId: 'v1', videoUrl: 'http://u', duration: 10 });
    expect(console.log).toHaveBeenCalledTimes(3);
  });

  it('logUploadError uses console.error', () => {
    logger.logUploadError('id', new Error('x'), { provider: 'youtube' });
    expect(console.error).toHaveBeenCalled();
  });

  it('logOAuth* cover start/callback/success/error', () => {
    const logId = 'id';
    logger.logOAuthStart(logId);
    logger.logOAuthCallback(logId, 'code-1');
    logger.logOAuthCallback(logId);
    logger.logOAuthSuccess(logId, { access_token: 'a', refresh_token: 'r' });
    logger.logOAuthSuccess(logId, {});
    logger.logOAuthError(logId, new Error('oauth boom'));
    expect(console.log).toHaveBeenCalledTimes(5);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('logInstagramAuthStart records', () => {
    logger.logInstagramAuthStart('id');
    expect(console.log).toHaveBeenCalled();
  });

  it('info without metadata includes only the logId in meta', () => {
    logger.info('message only');
    const [message, meta] = (console.log as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(message).toBe('message only');
    // logId is always present for correlation, even without caller metadata.
    expect(meta).toMatchObject({ logId: expect.any(String) });
  });

  it('repeated generateLogId calls produce distinct ids', () => {
    const id1 = logger.generateLogId();
    const id2 = logger.generateLogId();
    expect(id1).not.toBe(id2);
  });

  it('error without stack does not break', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const id = logger.error('msg', err);
    expect(typeof id).toBe('string');
  });
});

//---------------
// logger — production routing: dev/test go to console only,
// production errors/warnings also go to PostHog
//---------------

describe('logger production routing', () => {
  const capture = vi.fn();

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ capture });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('errorId correlates: returned logId appears in PostHog properties', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const logId = logger.error('insert failed', new Error('db down'));

    expect(capture).toHaveBeenCalledTimes(1);
    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    // The errorId returned to API clients must match the logId in the
    // PostHog event — otherwise users cannot correlate their report.
    expect(props['logId']).toBe(logId);
    expect(typeof logId).toBe('string');
    expect(logId.length).toBeGreaterThan(0);
  });

  it('production error() reports to PostHog and keeps console output', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = new Error('insert boom');
    logger.error('insert failed', err, { endpoint: '/api/schedule' });

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('$exception');
    expect(props).toMatchObject({
      $exception_message: 'insert boom',
      log_message: 'insert failed',
      endpoint: '/api/schedule',
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('non-production error() never touches PostHog', () => {
    vi.stubEnv('NODE_ENV', 'test');
    logger.error('insert failed', new Error('x'));
    expect(capture).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('production error() normalizes Supabase-style plain-object failures', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const pgError = { message: 'new row violates check constraint "schedules_providers_check"', code: '23514' };
    logger.error('insert failed', pgError);

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('$exception');
    expect(props['$exception_message']).toContain('schedules_providers_check');
    // Object causes are serialized to sanitized JSON (never raw objects to
    // a third-party cloud). The failure stays visible in the PostHog issue.
    const cause = props['cause'] as string;
    expect(typeof cause).toBe('string');
    expect(cause).toContain('schedules_providers_check');
    expect(JSON.parse(cause)).toMatchObject({ code: '23514' });
  });

  it('production warn() sends a warning to PostHog and keeps console output', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.warn('price changed', { packId: 'p1' });

    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('server_warning');
    expect(props).toMatchObject({ message: 'price changed', packId: 'p1' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('non-production warn() does not touch PostHog', () => {
    vi.stubEnv('NODE_ENV', 'development');
    logger.warn('price changed');
    expect(capture).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('info/debug never report to PostHog even in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.info('hello');
    logger.debug('detail');
    expect(capture).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it('production specialized error helpers report to PostHog', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.logUploadError('log-id', new Error('upload boom'), { provider: 'youtube' });
    logger.logOAuthError('log-id', new Error('oauth boom'));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('sanitizes string causes: redacts credential-shaped fragments (api_key, Bearer)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.error(
      'engine failed',
      'upstream 500: invalid request https://engine.internal/run?api_key=sk-live-secret-12345 detail',
    );

    expect(capture).toHaveBeenCalledTimes(1);
    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    const cause = props['cause'] as string;
    expect(cause).not.toContain('sk-live-secret-12345');
    expect(cause).toContain('api_key=[redacted]');
  });

  it('sanitizes string causes: redacts Bearer <redacted> and URL userinfo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.error(
      'engine failed',
      'call failed: Authorization Bearer abcdef123456, dsn https://user:pass@host/db',
    );

    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    const cause = props['cause'] as string;
    expect(cause).not.toContain('abcdef123456');
    expect(cause).toContain('Bearer [redacted]');
    expect(cause).toContain('https://[redacted]@host/db');
  });

  it('sanitizes string causes: truncates to 200 chars (MCP sanitizeEngineError convention)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.error('engine failed', `prefix ${'x'.repeat(500)}`);

    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect((props['cause'] as string).length).toBeLessThanOrEqual(200);
  });

  it('serializes object causes to sanitized JSON (never raw objects)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const pgError = { message: 'boom', code: '23514' };
    logger.error('insert failed', pgError);

    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    const cause = props['cause'] as string;
    expect(typeof cause).toBe('string');
    expect(JSON.parse(cause)).toEqual(pgError);
  });

  it('redacts secret-bearing keys inside object causes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logger.error('insert failed', { message: 'boom', api_key: 'sk-secret' });

    const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    const cause = props['cause'] as string;
    expect(cause).not.toContain('sk-secret');
    expect(cause).toContain('[redacted]');
  });

  it('a PostHog outage never breaks logging', () => {
    vi.stubEnv('NODE_ENV', 'production');
    capture.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => logger.error('boom', new Error('x'))).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('missing PostHog client never breaks logging', () => {
    vi.stubEnv('NODE_ENV', 'production');
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => logger.error('boom', new Error('x'))).not.toThrow();
    expect(() => logger.warn('careful')).not.toThrow();
    expect(console.error).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
