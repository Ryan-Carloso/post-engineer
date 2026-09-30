import { PostHog } from 'posthog-node';

//---------------
// Server-side PostHog client singleton.
//
// posthog-node is the server SDK: the browser posthog-js SDK must never
// run in Node API routes (it depends on browser APIs and on
// session-persistence semantics that don't apply server-side).
//
// Note: this module is imported by lib/logger.ts, which is also imported
// by client components (e.g. lib/api.ts). There is deliberately NO
// `import 'server-only'` here — instead getPostHogServer() returns null
// when running in the browser (typeof window !== 'undefined'), making
// client-side telemetry a safe no-op. The browser PostHog instance
// (instrumentation-client.ts) handles client-side capture separately.
//
// Reads configuration from environment variables:
// - POSTHOG_API_KEY (server-side, preferred) or NEXT_PUBLIC_POSTHOG_KEY (fallback)
// - NEXT_PUBLIC_POSTHOG_HOST (defaults to https://us.i.posthog.com)
//
// Returns null when not configured — telemetry must never break the app,
// so a missing key warns once and disables reporting instead of throwing.
//---------------

const DEFAULT_HOST = 'https://us.i.posthog.com';

// Server-side events have no user session: attribute them to the API
// server itself. Per-user attribution happens client-side.
const SERVER_DISTINCT_ID = 'post-engineer-server';

//---------------
// The surface logger.ts and analytics.ts use. Two-argument capture keeps
// the call shape they were written against; the wrapper translates it to
// posthog-node's { distinctId, event, properties } form.
//---------------

export interface ServerPostHogClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, properties?: Record<string, unknown>): void;
}

let cached: ServerPostHogClient | null = null;
let warned = false;
let attempted = false;

function warnOnce(message: string): void {
  if (!warned) {
    warned = true;
    console.warn(message);
  }
}

function toClient(client: PostHog): ServerPostHogClient {
  return {
    capture: (event, properties) => {
      client.capture({ distinctId: SERVER_DISTINCT_ID, event, properties });
    },
    captureException: (error, properties) => {
      client.captureException(error, SERVER_DISTINCT_ID, properties);
    },
  };
}

export function getPostHogServer(): ServerPostHogClient | null {
  // Client bundle safety: this module is reachable from client components
  // via lib/logger.ts. Never initialize the server SDK in the browser.
  if (typeof window !== 'undefined') return null;
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
    // Serverless (Vercel): best-effort immediate flush. flushAt: 1 starts an
    // async flush on every capture, but the function can freeze after the
    // response before the network write lands — rare 5xx $exception events
    // may still be dropped. Best posthog-node offers without wiring
    // await shutdown() into the request lifecycle.
    cached = toClient(new PostHog(key, { host, flushAt: 1 }));
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
