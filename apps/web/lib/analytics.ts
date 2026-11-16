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
import { scrubSecrets, redactCredentialFragments } from './scrub';

//---------------
// Public API
//---------------

//---------------
// Track a successful API operation (e.g. 'schedule_created').
// eventName should be snake_case. properties carries safe context only:
// ids, counts, validated enums — never credentials or raw bodies.
// Deliberate exception: 'post_metrics_collected' carries script_angle,
// the model-generated angle string, so angle performance can be grouped
// in PostHog; values still pass scrubSecrets + credential-fragment
// redaction + the 500-char cap above (see lib/metrics/post-metrics.ts).
//---------------

function safeProperties(properties?: Record<string, unknown>): Record<string, unknown> {
  const props = scrubSecrets({ ...(properties ?? {}) });
  // Fragment redaction for symmetry with logger.ts: string values can
  // carry credential-shaped fragments that key-name scrubbing misses.
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') props[k] = redactCredentialFragments(v).slice(0, 500);
  }
  return { ...props, $lib: 'posthog-server' };
}

export function trackApiEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    // Server-side distinct id: the API itself is the actor. Per-user
    // attribution happens client-side; here we track aggregate usage.
    client.capture(eventName, safeProperties(properties));
  } catch {
    // Telemetry must never break the request path.
  }
}

//---------------
// Same as trackApiEvent, attributed to one user (distinct_id). Use it for
// an event that a per-person PostHog funnel joins to the user's other
// events (e.g. experiment_video_linked next to experiment_results_fetched).
//---------------
export function trackApiEventAs(userId: string, eventName: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    client.captureAs(userId, eventName, safeProperties(properties));
  } catch {
    // Telemetry must never break the request path.
  }
}
