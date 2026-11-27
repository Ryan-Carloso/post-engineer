import { NextResponse } from 'next/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getBuildInfo } from '@/lib/version';
import { isPostHogServerConfigured } from '@/lib/posthog-server';
import { isSchedulerEnabled } from '@/lib/scheduler-jobs';

async function getHandler(request: Request) {
  const limited = await applyRateLimit(request, RATE_LIMITS.versionProbe);
  if (limited) return limited;
  const web = getBuildInfo();
  return NextResponse.json({
    ...web,
    posthogConfigured: isPostHogServerConfigured(),
    schedulerEnabled: isSchedulerEnabled(),
  });
}

export const GET = withApiErrorReporting('GET /api/version', getHandler);
