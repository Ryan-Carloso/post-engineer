import { NextResponse } from 'next/server';

import { engineBaseUrl } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { parsePreviewTextBody } from './preview-text';

type RouteContext = { params: Promise<{ voiceId: string }> };

async function postHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voicePreview, auth.userId);
  if (limited) {
    return limited;
  }

  const { voiceId } = await context.params;
  if (!voiceId.trim()) {
    return NextResponse.json({ success: false, error: 'Voice id is required.' }, { status: 400 });
  }

  // Optional caller text, validated before the engine call. The text is
  // never logged; only the parse error (which carries no text) is returned.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (error) {
    logger.error('[api/persona/voices/:id/preview] body unreadable', error);
    return NextResponse.json({ success: false, error: 'Invalid body.' }, { status: 400 });
  }
  const previewText = parsePreviewTextBody(rawBody);
  if (!previewText.ok) {
    return NextResponse.json({ success: false, error: previewText.error }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/voices/:id/preview] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  const url = new URL(`${baseUrl}/api/v1/personas/voices/${encodeURIComponent(voiceId)}/preview`);

  try {
    const upstream = await fetch(
      url.toString(),
      previewText.text === null
        ? { method: 'POST', headers: engineAuthHeaders(auth.userId) }
        : {
          method: 'POST',
          headers: { ...engineAuthHeaders(auth.userId), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: previewText.text }),
        },
    );
    if (upstream.status === 404) {
      return NextResponse.json({ success: false, error: 'Voice not found.' }, { status: 404 });
    }
    if (upstream.status === 422) {
      // Forward the engine's validation detail: a 422 is a malformed
      // request, not a down service, so it must not become a generic 502.
      // FastAPI's detail is a list of field errors; only a string detail
      // is forwarded verbatim.
      const data: unknown = await upstream.json().catch(() => null);
      const detail =
        typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined;
      return NextResponse.json(
        { success: false, error: typeof detail === 'string' ? detail : 'Validation error.' },
        { status: 422 },
      );
    }
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: 'Preview unavailable.' }, { status: 502 });
    }
    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    logger.error('[api/persona/voices/:id/preview] unreachable', error);
    return NextResponse.json({ success: false, error: 'Preview service unreachable.' }, { status: 502 });
  }
}

const POST_ROUTE = 'POST /api/persona/voices/[voiceId]/preview';

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, {
  getUserId: resolveReportingUserId,
});
