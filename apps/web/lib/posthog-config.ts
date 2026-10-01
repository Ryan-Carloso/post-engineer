//---------------
// PostHog host configuration.
//
// DEFAULT_POSTHOG_HOST is the fallback used when NEXT_PUBLIC_POSTHOG_HOST
// is not set. Change it here if you self-host PostHog — every telemetry
// path (browser client in instrumentation-client.ts, server SDK in
// lib/posthog-server.ts) reads this constant.
//---------------

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
