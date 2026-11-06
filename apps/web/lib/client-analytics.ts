//---------------
// Client product analytics. The server helper (lib/analytics.ts) attributes
// events to the API process. Browser facts — what a card actually painted —
// have to go through posthog-js so they stay on the signed-in distinct id.
//
// Safety rules match the server helper:
// - Never throws: telemetry must never break the UI.
// - Secret-bearing property keys and credential-shaped fragments are redacted.
// - String values are capped. No-op is not required when PostHog is
//   unconfigured: posthog-js drops captures until init, and init is skipped
//   when the key is missing.
//---------------

import posthog from 'posthog-js';
import { getTelemetryEnvironment } from './posthog-server';
import { redactCredentialFragments, scrubSecrets } from './scrub';

const STRING_CAP = 500;

export function trackClientEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const props = scrubSecrets({ ...(properties ?? {}) });
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string') props[key] = redactCredentialFragments(value).slice(0, STRING_CAP);
    }
    // Origin tags win over caller metadata, same rule as lib/posthog-server.ts.
    posthog.capture(eventName, {
      ...props,
      source: 'web-client',
      environment: getTelemetryEnvironment(),
      $lib: 'posthog-js',
    });
  } catch {
    // Telemetry must never break the UI.
  }
}
