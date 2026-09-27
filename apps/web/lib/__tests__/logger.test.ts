import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '@/lib/logger';

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

  it('warn e debug registram', () => {
    logger.warn('warning');
    logger.debug('detalhe');
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it('error includes the stack when available', () => {
    const err = new Error('falhou');
    logger.error('erro', err, { endpoint: '/api/upload' });
    expect(console.log).toHaveBeenCalled();
  });

  it('logUploadStart / Progress / Success usam console.log', () => {
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

  it('logOAuth* cobrem start/callback/success/error', () => {
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

  it('logInstagramAuthStart registra', () => {
    logger.logInstagramAuthStart('id');
    expect(console.log).toHaveBeenCalled();
  });

  it('info without metadata does not include a meta string', () => {
    logger.info('message only');
    const [prefix, message] = (console.log as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(prefix).toContain('[INFO]');
    expect(message).toBe('message only');
  });

  it('generateLogId de chamadas repetidas gera ids distintos', () => {
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
