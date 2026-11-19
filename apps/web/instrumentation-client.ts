import posthog from "posthog-js";
import { resolveHost } from "./lib/posthog-config";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (!key) {
  console.warn(
    "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled",
  );
} else {
  posthog.init(key, {
    api_host: resolveHost(process.env.NEXT_PUBLIC_POSTHOG_HOST, (message) =>
      console.warn(message),
    ),
    capture_exceptions: true,
  });
}

export default posthog;
