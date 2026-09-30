import { getDeployedVersion } from "./lib/version";

//---------------
// PostHog — server/edge telemetry. Optional: the app starts and runs
// fine without PostHog configured (the logger warns once and skips).
// Configuration comes from environment variables, never hardcoded:
// POSTHOG_API_KEY (server) or NEXT_PUBLIC_POSTHOG_KEY, plus
// NEXT_PUBLIC_POSTHOG_HOST (defaults to https://us.i.posthog.com).
//---------------

export async function register() {
  // Always first: identifies the live build in every log stream.
  console.log(`[web] starting version ${getDeployedVersion()}`);
}
