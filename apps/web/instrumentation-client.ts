import posthog from "posthog-js";
import { resolveHost } from "./lib/posthog-config";

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
    // Validated, not passed through: posthog-js accepts any string as
    // api_host and only fails later at send time. The same guard the server
    // SDK uses, so a project API key misconfigured as the host cannot
    // silently disable browser telemetry either (production incident,
    // 2026-10-13 — see lib/posthog-config.ts).
    api_host: resolveHost(process.env.NEXT_PUBLIC_POSTHOG_HOST, (message) =>
      console.warn(message),
    ),
    // Error tracking: capture unhandled exceptions automatically.
    capture_exceptions: true,
  });
}

export default posthog;
