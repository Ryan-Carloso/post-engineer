import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

type DownloadContext = {
  params: Promise<{ taskId: string; path: string[] }>;
};

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const;

//---------------
// GET /api/persona/video-download/:taskId/*path — authenticated binary proxy.
// The upstream host remains server-side.
//---------------
async function getHandler(request: Request, context: DownloadContext): Promise<NextResponse> {
  // Pass the request so API-key callers authenticate (without it only the
  // cookie session is checked, and API keys get a 401).
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  // The proxy streams arbitrary-size bodies — rate-limit the heavy surface.
  const limited = await applyRateLimit(request, RATE_LIMITS.mediaUpload, auth.userId);
  if (limited) return limited;

  const baseUrl = process.env.MONEYPRINT_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: 'GET /api/persona/video-download' });
  }

  const { taskId, path } = await context.params;
  if (!isSafePath(taskId, path)) {
    return apiErrorResponse(400, 'Invalid video filename.', { route: 'GET /api/persona/video-download' });
  }

  const source = new URL(request.url).searchParams.get('source') === 'stream' ? 'stream' : 'download';
  const upstreamUrl = `${baseUrl}/api/v1/${source}/${[taskId, ...path].map(encodeURIComponent).join('/')}`;
  const upstreamHeaders: Record<string, string> = engineAuthHeaders(auth.userId);
  const range = request.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  let upstream: Response;
  try {
    // redirect: 'manual' — the engine 302s to a signed Supabase Storage URL
    // when the local file is gone (see below); the proxy hands the browser
    // that URL instead of fetching video bytes itself.
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, cache: 'no-store', redirect: 'manual' });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-download',
      cause: error,
    });
  }

  if (upstream.status === 404) {
    // The guessed file name (final-1.mp4) is not what every engine task
    // stores. Consult the task record and redirect to the actual video
    // file so consumers never need to know the engine's naming. A miss is
    // always logged with both paths.
    const resolved = await resolveEngineVideoPath(taskId, auth.userId);
    if (resolved) {
      logger.warn('[video-download] requested file missing; redirecting', {
        taskId,
        requested: path.join('/'),
        resolved: resolved.join('/'),
      });
      const target = `/api/persona/video-download/${encodeURIComponent(taskId)}/${resolved
        .map(encodeURIComponent)
        .join('/')}${source === 'stream' ? '?source=stream' : ''}`;
      return NextResponse.redirect(new URL(target, request.url), 302);
    }
    logger.warn('[video-download] no video file found for task', {
      taskId,
      requested: path.join('/'),
    });
    return apiErrorResponse(404, 'Video file not found.', {
      route: 'GET /api/persona/video-download',
      metadata: { taskId },
    });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    // Engine storage fallback: the local file is gone (a restart wiped the
    // ephemeral disk) and the engine redirected to a signed Supabase Storage
    // URL for the archived final video. Pass it straight to the browser —
    // the signed URL is time-limited and unguessable, and Storage serves
    // range requests natively for seeking.
    const location = upstream.headers.get('location');
    if (location) {
      const status = [301, 302, 303, 307, 308].includes(upstream.status)
        ? (upstream.status as 301 | 302 | 303 | 307 | 308)
        : 302;
      return NextResponse.redirect(location, status);
    }
  }

  const responseHeaders = new Headers();
  for (const header of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

//---------------
// resolveEngineVideoPath — read-only lookup of the engine task record;
// deep-walks the payload for the first internal video URL
// (/api/v1/download|stream/{taskId}/file) and returns the file segments
// (without the taskId). Null when the task exposes no video file.
//---------------
async function resolveEngineVideoPath(taskId: string, userId: string): Promise<string[] | null> {
  const baseUrl = process.env.MONEYPRINT_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) return null;
  const prefix = `${taskId}/`;
  try {
    const response = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: engineAuthHeaders(userId),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    return findVideoSegments(body, prefix);
  } catch (error) {
    logger.warn('[video-download] task lookup failed during fallback', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function findVideoSegments(value: unknown, prefix: string): string[] | null {
  if (typeof value === 'string') {
    const match = value.match(/^\/api\/v1\/(?:download|stream)\/([^?\s]+)/);
    if (match && match[1].startsWith(prefix)) {
      const segments = match[1].slice(prefix.length).split('/');
      return segments.length > 0 ? segments : null;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoSegments(item, prefix);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      const found = findVideoSegments(item, prefix);
      if (found) return found;
    }
  }
  return null;
}

function isSafePath(taskId: string, path: string[]): boolean {
  return SAFE_TASK_ID.test(taskId)
    && path.length > 0
    && path.every((segment) => SAFE_TASK_ID.test(segment) && segment !== '.' && segment !== '..')
    && /\.[A-Za-z0-9]{1,8}$/.test(path[path.length - 1] ?? '');
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/video-download/[taskId]/[...path]', getHandler);
