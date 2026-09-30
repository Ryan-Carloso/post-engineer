//---------------
// API analytics: track successful (2xx) operations as PostHog events.
//
// Unlike error tracking (4xx/5xx via logger), these are product analytics:
// what users are doing, not what broke. Events flow into PostHog's
// product-analytics pipeline (1M/month free), separate from error tracking.
//
// Safety rules:
// - Never throws: telemetry must never break the request path.
// - Secret-bearing property keys are redacted before capture.
// - No-op when PostHog is not configured.
//---------------

import { getPostHogServer } from './posthog-server';

//---------------
// Secret scrubbing (same policy as api-error.ts: defense in depth).
//---------------

const SECRET_KEY_PATTERN =
  /password|passwd|secret|token|authorization|auth\b|api[-_]?key|bearer|credential|private[-_]?key|session/i;

const REDACTED = '[redacted]';

function scrubSecrets(properties: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return scrubbed;
}

//---------------
// Public API
//---------------

//---------------
// Track a successful API operation (e.g. 'schedule_created').
// eventName should be snake_case. properties carries safe context only:
// ids, counts, validated enums — never credentials or raw bodies.
//---------------

export function trackApiEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    const props = scrubSecrets({ ...(properties ?? {}) });
    // Server-side distinct id: the API itself is the actor. Per-user
    // attribution happens client-side; here we track aggregate usage.
    client.capture(eventName, { ...props, $lib: 'posthog-server' });
  } catch {
    // Telemetry must never break the request path.
  }
}
