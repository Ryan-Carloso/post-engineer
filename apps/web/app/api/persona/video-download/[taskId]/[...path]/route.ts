import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';

type DownloadContext = {
  params: Promise<{ taskId: string; path: string[] }>;
};

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const;

//---------------
// GET /api/persona/video-download/:taskId/*path — authenticated binary proxy.
// The upstream host remains server-side.
//---------------
export async function GET(request: Request, context: DownloadContext): Promise<NextResponse> {
  // Pass the request so API-key callers authenticate (without it only the
  // cookie session is checked, and API keys get a 401).
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

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
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, cache: 'no-store' });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-download',
      cause: error,
    });
  }

  const responseHeaders = new Headers();
  for (const header of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function isSafePath(taskId: string, path: string[]): boolean {
  return SAFE_SEGMENT.test(taskId)
    && path.length > 0
    && path.every((segment) => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..')
    && /\.[A-Za-z0-9]{1,8}$/.test(path[path.length - 1] ?? '');
}
