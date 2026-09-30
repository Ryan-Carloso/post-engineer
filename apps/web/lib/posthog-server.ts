//---------------
// Server-side PostHog client singleton.
//
// Reads configuration from environment variables:
// - POSTHOG_API_KEY (server-side, preferred) or NEXT_PUBLIC_POSTHOG_KEY (fallback)
// - NEXT_PUBLIC_POSTHOG_HOST (defaults to https://us.i.posthog.com)
//
// Returns null when not configured — telemetry must never break the app,
// so a missing key warns once and disables reporting instead of throwing.
//---------------

import posthog from 'posthog-js';
import type { PostHog } from 'posthog-js';

const DEFAULT_HOST = 'https://us.i.posthog.com';

let cached: PostHog | null = null;
let warned = false;
let attempted = false;

function warnOnce(message: string): void {
  if (!warned) {
    warned = true;
    console.warn(message);
  }
}

export function getPostHogServer(): PostHog | null {
  if (attempted) return cached;
  attempted = true;

  // Server key preferred; the public key works as a fallback for capture-only use.
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    warnOnce('[posthog] POSTHOG_API_KEY / NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled');
    cached = null;
    return cached;
  }

  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST;

  try {
    posthog.init(key, {
      api_host: host,
      // Server-side: no autocapture, no session recording, no persistence.
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      persistence: 'memory',
    });
    cached = posthog as unknown as PostHog;
  } catch {
    warnOnce('[posthog] Failed to initialize PostHog client — telemetry disabled');
    cached = null;
  }

  return cached;
}

//---------------
// Test seam: reset the singleton between tests.
//---------------

export function __resetPostHogServerForTests(): void {
  cached = null;
  warned = false;
  attempted = false;
}
