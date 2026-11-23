import { NextResponse } from 'next/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { getBuildInfo, parseBuildInfo } from '@/lib/version';
import { isPostHogServerConfigured } from '@/lib/posthog-server';
import { isSchedulerEnabled } from '@/lib/scheduler-jobs';

const ENGINE_VERSION_TIMEOUT_MS = 5000;

async function getHandler(request: Request) {
  const limited = await applyRateLimit(request, RATE_LIMITS.versionProbe);
  if (limited) return limited;
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/version`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      return apiErrorResponse(502, 'Engine version unavailable', {
        route: 'GET /api/version',
        code: 'engine_unreachable',
        metadata: { engineStatus: response.status },
      });
    }
    const body: unknown = await response.json().catch(() => null);
    const info = parseBuildInfo(body);
    if (!info) {
      return apiErrorResponse(502, 'Engine version unavailable', {
        route: 'GET /api/version',
        code: 'engine_unreachable',
        logMessage: 'Engine /version returned an unexpected payload',
      });
    }
    const web = getBuildInfo();
    return NextResponse.json({
      ...info,
      posthogConfigured: isPostHogServerConfigured(),
      web: {
        version: web.version,
        pr: web.pr,
        commit: web.commit,
        builtAt: web.builtAt,
        schedulerEnabled: isSchedulerEnabled(),
      },
    });
  } catch (cause) {
    return apiErrorResponse(502, 'Engine version unavailable', {
      route: 'GET /api/version',
      code: 'engine_unreachable',
      cause,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = withApiErrorReporting('GET /api/version', getHandler);
