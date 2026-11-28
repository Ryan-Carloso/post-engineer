import { formatBuildInfo, getBuildInfo } from "./lib/version";
import { toError } from "./lib/logger";
import { flushPostHog, getPostHogServer } from "./lib/posthog-server";

export async function register() {
  const build = getBuildInfo();
  const commitSuffix = build.commit ? ` ${build.commit}` : '';
  console.log(`[web] starting version ${formatBuildInfo(build)}${commitSuffix}`);
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      console.warn(
        '[web] POSTHOG_API_KEY / NEXT_PUBLIC_POSTHOG_KEY not set — ' +
        'PostHog error tracking and analytics are DISABLED in production. ' +
        'Set the env var and redeploy to enable telemetry.'
      );
    } else {
      getPostHogServer();
    }
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production') {
      const { reportSchemaDrift } = await import('./lib/schema-drift');
      void reportSchemaDrift();
    }
    const { startInternalScheduler, isSchedulerEnabled } = await import('./lib/scheduler-jobs');
    if (isSchedulerEnabled()) {
      startInternalScheduler();
    } else if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[web] internal scheduler DISABLED in production: ' +
          `NODE_ENV=${process.env.NODE_ENV ?? 'unset'} ` +
          `NEXT_RUNTIME=${process.env.NEXT_RUNTIME ?? 'unset'} ` +
          `SCHEDULER_ENABLED=${process.env.SCHEDULER_ENABLED ?? 'unset'}. ` +
          'Set NODE_ENV=production or SCHEDULER_ENABLED=true and redeploy — ' +
          'post metrics, token refresh and scheduled publishing will not run.',
      );
    }
  }
}

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
    client.captureException(toError(error), {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
    });
    await flushPostHog();
  } catch {
  }
}
