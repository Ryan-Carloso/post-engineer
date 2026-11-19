import { getPostHogServer } from './posthog-server';
import { scrubSecrets, redactCredentialFragments } from './scrub';

function safeProperties(properties?: Record<string, unknown>): Record<string, unknown> {
  const props = scrubSecrets({ ...(properties ?? {}) });
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') props[k] = redactCredentialFragments(v).slice(0, 500);
  }
  return { ...props, $lib: 'posthog-server' };
}

export function trackApiEvent(eventName: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    client.capture(eventName, safeProperties(properties));
  } catch {
  }
}

export function trackApiEventAs(userId: string, eventName: string, properties?: Record<string, unknown>): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    client.captureAs(userId, eventName, safeProperties(properties));
  } catch {
  }
}
