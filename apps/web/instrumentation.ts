import { getDeployedVersion } from "./lib/version";
import { getPostHogServer } from "./lib/posthog-server";

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

//---------------
// onRequestError — Next.js calls this for unhandled errors in request
// scope (route handlers, server components). Captured to PostHog's
// server-side error tracking with the request context. Never throws:
// telemetry must never break error handling itself.
//---------------

interface RequestErrorRequest {
  path: string;
  method: string;
}

interface RequestErrorContext {
  routerKind: string;
}

export async function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): Promise<void> {
  try {
    const client = getPostHogServer();
    if (!client) return;
    client.captureException(error, {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
    });
  } catch {
    // Telemetry must never break the request path.
  }
}
