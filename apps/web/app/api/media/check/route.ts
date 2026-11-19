import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

const ROUTE = 'POST /api/media/check';

const CHECK_CODES = new Set([
  'ok',
  'blocked_403',
  'not_image',
  'too_small',
  'too_large',
  'timeout',
  'wrong_aspect',
  'media_expired',
]);

const VIDEO_ASPECTS = new Set(['9:16', '16:9', '1:1']);

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.mediaUpload);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', { route: ROUTE });
  }
  const requestBody =
    typeof body === 'object' && body !== null
      ? (body as { url?: unknown; videoAspect?: unknown })
      : {};
  const url = requestBody.url;
  if (typeof url !== 'string' || url.length === 0) {
    return apiErrorResponse(400, 'url is required.', { route: ROUTE });
  }
  const videoAspect = requestBody.videoAspect;
  if (
    videoAspect !== undefined &&
    (typeof videoAspect !== 'string' || !VIDEO_ASPECTS.has(videoAspect))
  ) {
    return apiErrorResponse(400, 'videoAspect must be 9:16, 16:9 or 1:1.', { route: ROUTE });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return apiErrorResponse(400, 'url must be an http(s) URL.', { route: ROUTE });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return apiErrorResponse(400, 'url must be an http(s) URL.', { route: ROUTE });
  }

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: ROUTE });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/media/check`, {
      method: 'POST',
      headers: { ...engineAuthHeaders(auth.userId), 'Content-Type': 'application/json' },
      body: JSON.stringify(
        videoAspect === undefined ? { url } : { url, video_aspect: videoAspect },
      ),
    });
  } catch {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  const payload: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok || typeof payload !== 'object' || payload === null) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  const record = payload as { body?: unknown };
  const checked =
    typeof record.body === 'object' && record.body !== null
      ? (record.body as { code?: unknown; width?: unknown; height?: unknown; has_face?: unknown })
      : {};
  if (typeof checked.code !== 'string' || !CHECK_CODES.has(checked.code)) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  const response: {
    success: true;
    code: string;
    width?: number;
    height?: number;
    has_face?: boolean | null;
  } = {
    success: true,
    code: checked.code,
  };
  if (typeof checked.width === 'number' && Number.isFinite(checked.width)) {
    response.width = checked.width;
  }
  if (typeof checked.height === 'number' && Number.isFinite(checked.height)) {
    response.height = checked.height;
  }
  if (typeof checked.has_face === 'boolean' || checked.has_face === null) {
    response.has_face = checked.has_face;
  }
  return NextResponse.json(response);
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
