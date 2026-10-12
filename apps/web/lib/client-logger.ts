//---------------
// Client-safe error reporter for "use client" components.
//
// The server logger (lib/logger.ts) uses posthog-node via
// lib/posthog-server.ts. That module returns null in the browser (runtime
// guard), so client components must not rely on it. This module mirrors the
// server logger's error() call shape but reports to the browser PostHog
// SDK (initialized once by instrumentation-client.ts).
//
// Telemetry must never break the UI: capture failures are swallowed and
// the console output always happens.
//---------------

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
    // Origin tags (convention shared with lib/posthog-server.ts): ours win
    // over caller metadata so the event origin can never be spoofed away.
    posthog.captureException(exception, {
      message,
      ...metadata,
      source: 'web-client',
      environment: getTelemetryEnvironment(),
    });
  } catch {
    // Telemetry must never break the UI.
  }
}
