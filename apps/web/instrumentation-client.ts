import posthog from "posthog-js";

//---------------
// PostHog — client/browser telemetry (error tracking, analytics,
// feature flags). Optional: the app runs fine without the key
// configured (warns once, skips initialization).
// Configuration from environment variables, never hardcoded:
// NEXT_PUBLIC_POSTHOG_KEY and NEXT_PUBLIC_POSTHOG_HOST
// (defaults to https://us.i.posthog.com).
//---------------

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (!key) {
  console.warn(
    "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled",
  );
} else {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // Error tracking: capture unhandled exceptions automatically.
    capture_exceptions: true,
  });
}

export default posthog;
