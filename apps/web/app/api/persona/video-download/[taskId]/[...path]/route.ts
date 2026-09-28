import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

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
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: 'MONEYPRINT_API_URL is not defined' }, { status: 500 });
  }

  const { taskId, path } = await context.params;
  if (!isSafePath(taskId, path)) {
    return NextResponse.json({ success: false, error: 'Invalid video filename.' }, { status: 400 });
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
    logger.error('[api/persona/video-download] upstream unavailable', error);
    return NextResponse.json({ success: false, error: 'Video service is unavailable.' }, { status: 502 });
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
