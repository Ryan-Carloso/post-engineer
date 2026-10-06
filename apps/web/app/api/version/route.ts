import { NextResponse } from 'next/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { apiErrorResponse } from '@/lib/api-error';
import { parseBuildInfo } from '@/lib/version';

//---------------
// Public version endpoint — no auth required. Proxies the engine's
// GET /version so the UI always shows the SAME version and build the
// backend runs (the engine is the single source of truth for "what is
// live"). An unreachable or misbehaving engine is a loud 502
// (engine_unreachable, reported to PostHog) — the version badge degrades
// to a bare "BETA" pill rather than showing a stale or web-only version.
//---------------
const ENGINE_VERSION_TIMEOUT_MS = 5000;

async function getHandler() {
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
    return NextResponse.json(info);
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/version', getHandler);
