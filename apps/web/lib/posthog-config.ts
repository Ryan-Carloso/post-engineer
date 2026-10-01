//---------------
// PostHog host configuration.
//
// DEFAULT_POSTHOG_HOST is the fallback used when NEXT_PUBLIC_POSTHOG_HOST
// is not set. Change it here if you self-host PostHog — every telemetry
// path (browser client in instrumentation-client.ts, server SDK in
// lib/posthog-server.ts) reads this constant. Keep the value in sync with
// the engine (app/services/analytics.py) and MCP (src/analytics.ts)
// constants — lib/__tests__/posthog-config.test.ts enforces it.
//---------------

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
