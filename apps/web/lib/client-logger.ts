//---------------
// Client-safe error reporter for "use client" components.
//
// The server logger (lib/logger.ts) pulls in posthog-node via
// lib/posthog-server.ts, which declares `import 'server-only'` and must
// never be bundled into client components. This module mirrors the
// server logger's error() call shape but reports to the browser PostHog
// SDK (initialized once by instrumentation-client.ts).
//
// Telemetry must never break the UI: capture failures are swallowed and
// the console output always happens.
//---------------

import posthog from 'posthog-js';

export function logClientError(
  message: string,
  error?: unknown,
  metadata?: Record<string, unknown>,
): void {
  console.error(message, metadata ?? {}, error ?? '');

  try {
    if (error === undefined || error === null) return;
    const exception = error instanceof Error ? error : new Error(`${message}: ${String(error)}`);
    posthog.captureException(exception, { message, ...metadata });
  } catch {
    // Telemetry must never break the UI.
  }
}
