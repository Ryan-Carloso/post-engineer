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
    posthog.capture(eventName, {
      ...props,
      source: 'web-client',
      environment: getTelemetryEnvironment(),
      $lib: 'posthog-js',
    });
  } catch {
  }
}
