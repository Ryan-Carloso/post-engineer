import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { enforceScopedTaskRead } from '@/lib/video-task-scope';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  isCompletedVideoStatus,
  isFailedVideoStatus,
  isPendingVideoStatus,
} from '@/lib/engine-task-state';

type DownloadContext = {
  params: Promise<{ taskId: string; path: string[] }>;
};

// resolveEngineVideoPath outcome: the video path to redirect to, or the
// reason no video will (or may yet) exist. `gone` and `failed` are terminal
// and answer 410 Gone; `pending` and `unknown` stay 404 Not Found.
type VideoPathResolution =
  | { kind: 'path'; segments: string[] }
  | { kind: 'gone' }
  | { kind: 'failed' }
  | { kind: 'pending' }
  | { kind: 'unknown'; lookupError?: unknown };

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

  // The proxy streams arbitrary-size bodies — rate-limit the heavy surface,
  // with its own playback-sized budget (not the upload one).
  const limited = await applyRateLimit(request, RATE_LIMITS.videoDownload, auth.userId);
  if (limited) return limited;

  const baseUrl = process.env.MONEYPRINT_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: 'GET /api/persona/video-download' });
  }

  const { taskId, path } = await context.params;
  if (!isSafePath(taskId, path)) {
    return apiErrorResponse(400, 'Invalid video filename.', { route: 'GET /api/persona/video-download' });
  }

  // Before either engine fetch (the file, and the 404 path fallback).
  // Out of scope answers the same 404 as a missing file.
  const scopeError = await enforceScopedTaskRead(
    auth,
    taskId,
    'GET /api/persona/video-download',
    'Video file not found.',
  );
  if (scopeError) return scopeError;

  const source = new URL(request.url).searchParams.get('source') === 'stream' ? 'stream' : 'download';
  const upstreamUrl = `${baseUrl}/api/v1/${source}/${[taskId, ...path].map(encodeURIComponent).join('/')}`;
  const upstreamHeaders: Record<string, string> = engineAuthHeaders(auth.userId);
  const range = request.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  let upstream: Response;
  try {
    // redirect: 'manual' — the engine always serves from the archive now and
    // 302s to a signed Cloudflare R2 URL; the proxy hands that URL to the
    // browser instead of fetching video bytes itself, so the R2 credentials
    // stay server-side and this route keeps enforcing auth + rate limiting.
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
    // file so consumers never need to know the engine's naming.
    const resolution = await resolveEngineVideoPath(taskId, auth.userId);
    // Self-redirect guard: the engine keeps 404ing this exact file (a task
    // that has not finished, or a file that is simply gone). Redirecting to
    // the resolved path would loop 302 -> 404 -> 302 until the browser gives
    // up, so a self-match is treated as missing instead of redirecting.
    if (resolution.kind === 'path' && !isSamePath(resolution.segments, path)) {
      logger.warn('[video-download] requested file missing; redirecting', {
        taskId,
        requested: path.join('/'),
        resolved: resolution.segments.join('/'),
      });
      const target = `/api/persona/video-download/${encodeURIComponent(taskId)}/${resolution.segments
        .map(encodeURIComponent)
        .join('/')}${source === 'stream' ? '?source=stream' : ''}`;
      return NextResponse.redirect(new URL(target, request.url), 302);
    }
    // One warning per miss via apiErrorResponse, carrying taskId, requested
    // and reason. Terminal states answer 410 Gone so the caller stops
    // polling; pending/unknown stay 404. The engine's failure text is not
    // read at all: the status route owns recording why a task failed.
    // A transient lookup error rides as the cause, which apiErrorResponse
    // scrubs and caps before it reaches the log.
    const reason = resolution.kind === 'path' ? 'unknown' : resolution.kind;
    const status = reason === 'gone' || reason === 'failed' ? 410 : 404;
    const message = status === 410 ? 'The video is no longer available.' : 'Video file not found.';
    return apiErrorResponse(status, message, {
      route: 'GET /api/persona/video-download',
      metadata: { taskId, requested: path.join('/'), reason },
      ...(resolution.kind === 'unknown' && resolution.lookupError !== undefined
        ? { cause: resolution.lookupError }
        : {}),
    });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    // The engine redirected to a signed R2 URL for the archived, size-verified
    // final video. Pass it straight to the browser — the signed URL is
    // time-limited and unguessable, and R2 serves range requests natively for
    // seeking. The local engine disk is never read.
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
// resolveEngineVideoPath — read-only lookup of the engine task record.
// Deep-walks the BaseResponse envelope ({ status, message, body }) for the
// first internal video URL (/api/v1/download|stream/{taskId}/file) and
// returns its file segments (without the taskId). A lookup HTTP 404 means
// the engine no longer knows the task (gone); numeric state -1 (or a failed
// string status) is failed; state 1 with no file is gone because the file
// will not appear; states 3/4 are pending. Every lookup failure that cannot
// prove a verdict (network error, non-404 non-OK, unparseable body, missing
// env) is unknown and stays a transient 404. Never logs: the caller emits
// the single miss warning.
//---------------
async function resolveEngineVideoPath(taskId: string, userId: string): Promise<VideoPathResolution> {
  const baseUrl = process.env.MONEYPRINT_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) return { kind: 'unknown' };
  const prefix = `${taskId}/`;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: engineAuthHeaders(userId),
      cache: 'no-store',
    });
  } catch (error) {
    // Transient: the miss warning carries the cause (scrubbed by apiErrorResponse).
    return { kind: 'unknown', lookupError: error };
  }
  if (response.status === 404) return { kind: 'gone' };
  if (!response.ok) return { kind: 'unknown' };
  const body: unknown = await response.json().catch(() => null);
  if (body === null) return { kind: 'unknown' };
  const segments = findVideoSegments(body, prefix);
  if (segments !== null) return { kind: 'path', segments };
  if (isFailedVideoStatus(body)) return { kind: 'failed' };
  // Complete with no video URL: the file will never appear.
  if (isCompletedVideoStatus(body)) return { kind: 'gone' };
  if (isPendingVideoStatus(body)) return { kind: 'pending' };
  return { kind: 'unknown' };
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
// isSamePath — segment-wise comparison of the resolved engine path against
// the requested path. The resolved segments may still be percent-encoded
// (they come from the engine's task body); the requested ones arrive
// decoded from Next.js params.
//---------------
function isSamePath(resolved: string[], requested: string[]): boolean {
  if (resolved.length !== requested.length) return false;
  return resolved.every((segment, i) => safeDecodeSegment(segment) === requested[i]);
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/video-download/[taskId]/[...path]', getHandler, { getUserId: resolveReportingUserId });
