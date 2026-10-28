//---------------
// POST /api/media/check — mechanical image URL check (MCP check_media).
//
// The caller authenticates with a session or API key; the route proxies
// to the engine's /api/v1/media/check with the server secret, where the
// SSRF-safe download and the mechanical checks run (download refusal,
// real image type, size bounds, face detection). The response carries
// only the code — never the checked URL, which can hold credentials in
// its query string. No LLM runs here and no relevance is judged: the
// agent, who sees the image, decides relevance.
//---------------

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
  'face_detected',
]);

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
  const url =
    typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : undefined;
  if (typeof url !== 'string' || url.length === 0) {
    return apiErrorResponse(400, 'url is required.', { route: ROUTE });
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
      body: JSON.stringify({ url }),
    });
  } catch {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  const payload: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok || typeof payload !== 'object' || payload === null) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  const record = payload as { body?: unknown };
  const code =
    typeof record.body === 'object' && record.body !== null
      ? (record.body as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'string' || !CHECK_CODES.has(code)) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  return NextResponse.json({ success: true, code });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
