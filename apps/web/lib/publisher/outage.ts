import { OUTAGE_REMINDER_MS } from '@/lib/publisher/constants';
import { diagnosticOf } from '@/lib/publisher/scrub-error';

const CONNECTION_PATTERN =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network|timed out|timeout|bad gateway|service unavailable|gateway time-?out|<html/i;

export function isConnectionFailure(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    if (CONNECTION_PATTERN.test(error.message)) return true;
    return 'cause' in error && error.cause !== error && isConnectionFailure(error.cause);
  }
  return typeof error === 'string' && CONNECTION_PATTERN.test(error);
}

export interface OutageLogger {
  info(message: string, metadata?: Record<string, unknown>): unknown;
  error(message: string, cause?: unknown, metadata?: Record<string, unknown>): unknown;
}

export interface OutageTracker {
  report(error: unknown, at: Date): void;
  recovered(at: Date): void;
}

export function createOutageTracker(log: OutageLogger): OutageTracker {
  let since: Date | null = null;
  let reportedAt: Date | null = null;
  let failures = 0;

  const seconds = (at: Date): number => (since === null ? 0 : Math.floor((at.getTime() - since.getTime()) / 1000));

  return {
    report(error, at) {
      failures += 1;
      if (reportedAt === null) {
        since = at;
        reportedAt = at;
        log.error('[publisher] connection outage started', error, { diagnostic: diagnosticOf(error) });
        return;
      }
      if (at.getTime() - reportedAt.getTime() >= OUTAGE_REMINDER_MS) {
        reportedAt = at;
        log.error('[publisher] connection outage ongoing', error, {
          seconds: seconds(at),
          failedTicks: failures,
          diagnostic: diagnosticOf(error),
        });
        return;
      }
      log.info('[publisher] tick failed during connection outage', { diagnostic: diagnosticOf(error) });
    },
    recovered(at) {
      if (since === null) return;
      log.info('[publisher] connection outage over', { seconds: seconds(at), failedTicks: failures });
      since = null;
      reportedAt = null;
      failures = 0;
    },
  };
}
