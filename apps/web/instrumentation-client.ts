import posthog from "posthog-js";
import { DEFAULT_POSTHOG_HOST } from "./lib/posthog-config";

//---------------
// PostHog — client/browser telemetry (error tracking, analytics,
// feature flags). Optional: the app runs fine without the key
// configured (warns once, skips initialization).
// Configuration from environment variables, never hardcoded:
// NEXT_PUBLIC_POSTHOG_KEY and NEXT_PUBLIC_POSTHOG_HOST
// (defaults to DEFAULT_POSTHOG_HOST — change the constant in
// lib/posthog-config.ts to self-host).
//---------------

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (!key) {
  console.warn(
    "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled",
  );
} else {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    // Error tracking: capture unhandled exceptions automatically.
    capture_exceptions: true,
  });
}

export default posthog;
