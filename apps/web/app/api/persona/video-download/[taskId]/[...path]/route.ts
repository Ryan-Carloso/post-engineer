import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { sameOriginRedirect } from '@/lib/same-origin-redirect';
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

type VideoPathResolution =
  | { kind: 'path'; segments: string[] }
  | { kind: 'gone' }
  | { kind: 'failed' }
  | { kind: 'pending' }
  | { kind: 'unknown'; lookupError?: unknown };

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const;

async function getHandler(request: Request, context: DownloadContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

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
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, cache: 'no-store', redirect: 'manual' });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-download',
      cause: error,
    });
  }

  if (upstream.status === 404) {
    const resolution = await resolveEngineVideoPath(taskId, auth.userId);
    if (resolution.kind === 'path' && !isSamePath(resolution.segments, path)) {
      logger.warn('[video-download] requested file missing; redirecting', {
        taskId,
        requested: path.join('/'),
        resolved: resolution.segments.join('/'),
      });
      const target = `/api/persona/video-download/${encodeURIComponent(taskId)}/${resolution.segments
        .map(encodeURIComponent)
        .join('/')}${source === 'stream' ? '?source=stream' : ''}`;
      return sameOriginRedirect(target, 302);
    }
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
    return { kind: 'unknown', lookupError: error };
  }
  if (response.status === 404) return { kind: 'gone' };
  if (!response.ok) return { kind: 'unknown' };
  const body: unknown = await response.json().catch(() => null);
  if (body === null) return { kind: 'unknown' };
  const segments = findVideoSegments(body, prefix);
  if (segments !== null) return { kind: 'path', segments };
  if (isFailedVideoStatus(body)) return { kind: 'failed' };
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

export const GET = withApiErrorReporting('GET /api/persona/video-download/[taskId]/[...path]', getHandler, { getUserId: resolveReportingUserId });
