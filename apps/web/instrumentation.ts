import { getDeployedVersion } from "./lib/version";
import { flushPostHog, getPostHogServer } from "./lib/posthog-server";

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

  // Loud startup signal: if PostHog is unconfigured in production, say so
  // clearly. Telemetry is optional, but a silent misconfiguration (typo'd
  // key) is worse than a noisy one.
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      console.warn(
        '[web] POSTHOG_API_KEY / NEXT_PUBLIC_POSTHOG_KEY not set — ' +
        'PostHog error tracking and analytics are DISABLED in production. ' +
        'Set the env var and redeploy to enable telemetry.'
      );
    } else {
      // Trigger the lazy SDK load now so the first real error doesn't pay
      // the import cost.
      getPostHogServer();
    }
  }
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
    // Next.js awaits onRequestError: flush so the $exception event is
    // delivered before a serverless function freezes. Without this,
    // fire-and-forget captures can be dropped on Vercel.
    await flushPostHog();
  } catch {
    // Telemetry must never break the request path.
  }
}
