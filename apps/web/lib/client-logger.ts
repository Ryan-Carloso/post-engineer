import posthog from 'posthog-js';
import { getTelemetryEnvironment } from './posthog-server';

export function logClientError(
  message: string,
  error?: unknown,
  metadata?: Record<string, unknown>,
): void {
  console.error(message, metadata ?? {}, error ?? '');

  try {
    if (error === undefined || error === null) return;
    const exception = error instanceof Error ? error : new Error(`${message}: ${String(error)}`);
    posthog.captureException(exception, {
      message,
      ...metadata,
      source: 'web-client',
      environment: getTelemetryEnvironment(),
    });
  } catch {
  }
}
