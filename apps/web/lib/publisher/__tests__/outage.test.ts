import { describe, expect, it, vi } from 'vitest';
import { OUTAGE_REMINDER_MS } from '@/lib/publisher/constants';
import { createOutageTracker, isConnectionFailure } from '@/lib/publisher/outage';
import { NOW } from './helpers';

describe('isConnectionFailure', () => {
  it.each([
    new TypeError('fetch failed'),
    new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    new Error('read ECONNRESET'),
    new Error('getaddrinfo ENOTFOUND db.example'),
    new Error('request timed out'),
    new Error('<html><title>502 Bad Gateway</title></html>'),
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    Object.assign(new Error('x'), { name: 'TimeoutError' }),
  ])('recognizes %s', (error) => {
    expect(isConnectionFailure(error)).toBe(true);
  });

  it('follows the cause chain and accepts a connection message string', () => {
    expect(isConnectionFailure(Object.assign(new Error('query failed'), { cause: new Error('socket hang up') }))).toBe(true);
    expect(isConnectionFailure('ECONNRESET')).toBe(true);
  });

  it('does not treat data errors as connection failures', () => {
    expect(isConnectionFailure(new Error('Instagram token expired'))).toBe(false);
    expect(isConnectionFailure(new Error('claim_next_publish_slot returned a row without an id'))).toBe(false);
    expect(isConnectionFailure({ message: 'fetch failed' })).toBe(false);
    expect(isConnectionFailure(Object.assign(new Error('x'), { cause: 'plain' }))).toBe(false);
  });
});

describe('createOutageTracker', () => {
  function tracker() {
    const log = { info: vi.fn(), error: vi.fn() };
    return { log, outage: createOutageTracker(log) };
  }
  const after = (ms: number): Date => new Date(NOW.getTime() + ms);

  it('logs the first failure once at error level', () => {
    const { log, outage } = tracker();
    outage.report(new TypeError('fetch failed'), NOW);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith('[publisher] connection outage started', expect.any(TypeError), {
      diagnostic: 'TypeError: fetch failed',
    });
  });

  it('keeps later failures at info level until the reminder is due, then reminds every 30 minutes', () => {
    const { log, outage } = tracker();
    outage.report(new Error('a'), NOW);
    outage.report(new Error('b'), after(60_000));
    outage.report(new Error('c'), after(OUTAGE_REMINDER_MS - 1));
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledTimes(2);

    outage.report(new Error('d'), after(OUTAGE_REMINDER_MS));
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenLastCalledWith('[publisher] connection outage ongoing', expect.any(Error), {
      seconds: 1800,
      failedTicks: 4,
      diagnostic: 'Error: d',
    });

    outage.report(new Error('e'), after(OUTAGE_REMINDER_MS + 60_000));
    expect(log.error).toHaveBeenCalledTimes(2);
    outage.report(new Error('f'), after(2 * OUTAGE_REMINDER_MS));
    expect(log.error).toHaveBeenCalledTimes(3);
  });

  it('logs recovery once and starts a new incident afterwards', () => {
    const { log, outage } = tracker();
    outage.recovered(NOW);
    expect(log.info).not.toHaveBeenCalled();
    outage.report(new Error('a'), NOW);
    outage.report(new Error('b'), after(90_000));
    outage.recovered(after(120_000));
    expect(log.info).toHaveBeenLastCalledWith('[publisher] connection outage over', { seconds: 120, failedTicks: 2 });
    outage.recovered(after(180_000));
    expect(log.info).toHaveBeenCalledTimes(2);
    outage.report(new Error('c'), after(240_000));
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenLastCalledWith('[publisher] connection outage started', expect.any(Error), { diagnostic: 'Error: c' });
  });
});
