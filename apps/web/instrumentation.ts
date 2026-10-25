import { formatBuildInfo, getBuildInfo } from "./lib/version";
import { flushPostHog, getPostHogServer } from "./lib/posthog-server";

//---------------
// PostHog — server/edge telemetry. Optional: the app starts and runs
// fine without PostHog configured (the logger warns once and skips).
// Configuration comes from environment variables, never hardcoded:
// POSTHOG_API_KEY (server) or NEXT_PUBLIC_POSTHOG_KEY, plus
// NEXT_PUBLIC_POSTHOG_HOST (defaults to DEFAULT_POSTHOG_HOST in
// lib/posthog-config.ts — change the constant there to self-host).
//---------------

export async function register() {
  // Always first: identifies the live build in every log stream.
  const build = getBuildInfo();
  const commitSuffix = build.commit ? ` ${build.commit}` : '';
  console.log(`[web] starting version ${formatBuildInfo(build)}${commitSuffix}`);
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

  //---------------
  // Internal scheduler — post-metrics (hourly) and billing-reconcile
  // (daily) run inside this server process (lib/scheduler-jobs.ts), with
  // a DB lease so only one replica executes each tick. No public HTTP
  // route, no CRON_SECRET, no pg_cron. SCHEDULER_ENABLED=false (and the
  // test environment) disables it.
  //
  // Node runtime only (guarded with the dynamic import INSIDE the
  // branch): instrumentation is also compiled for the edge runtime,
  // where the scheduler's chain (crypto in lib/token-crypto.ts etc.)
  // does not resolve.
  //---------------
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startInternalScheduler, isSchedulerEnabled } = await import('./lib/scheduler-jobs');
    if (isSchedulerEnabled()) {
      startInternalScheduler();
    } else if (process.env.NODE_ENV === 'production') {
      // Never silent: the scheduler owns post-metrics AND billing
      // reconciliation (stuckgeneration checks, stale auto-refunds). A
      // production deploy with the scheduler disabled means no refund or
      // reconcile ever lands, so say exactly why it was skipped, once.
      console.warn(
        '[web] internal scheduler DISABLED in production: ' +
          `NODE_ENV=${process.env.NODE_ENV ?? 'unset'} ` +
          `NEXT_RUNTIME=${process.env.NEXT_RUNTIME ?? 'unset'} ` +
          `SCHEDULER_ENABLED=${process.env.SCHEDULER_ENABLED ?? 'unset'}. ` +
          'Set NODE_ENV=production or SCHEDULER_ENABLED=true and redeploy — ' +
          'stuck-generation reconciliation and post metrics will not run.',
      );
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
