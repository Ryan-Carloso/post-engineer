import { NextResponse } from 'next/server';

import { engineBaseUrl } from '@/lib/engine-proxy';
import { isEnglishLanguage, ONLY_ENGLISH_CLONE_MESSAGE } from '@/lib/language-gate';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { parsePreviewTextBody } from './preview-text';

type RouteContext = { params: Promise<{ cloneId: string }> };

async function postHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voiceClonePreview, auth.userId);
  if (limited) {
    return limited;
  }

  const { cloneId } = await context.params;
  if (!cloneId.trim()) {
    return NextResponse.json({ success: false, error: 'Clone id is required.' }, { status: 400 });
  }

  // Optional caller text, validated before the engine call. The text is
  // never logged; only the parse error (which carries no text) is returned.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (error) {
    logger.error('[api/persona/cloned-voices/:id/preview] body unreadable', error);
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
    logger.error('[api/persona/cloned-voices/:id/preview] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  const url = new URL(`${baseUrl}/api/v1/cloned-voices/${encodeURIComponent(cloneId)}/preview`);
  const language = new URL(request.url).searchParams.get('language');
  if (language && language.trim()) {
    // English-only launch: a preview renders the cloned voice speaking, so
    // a non-English override is rejected before it reaches the engine.
    if (!isEnglishLanguage(language)) {
      return NextResponse.json(
        { success: false, error: ONLY_ENGLISH_CLONE_MESSAGE },
        { status: 400 },
      );
    }
    url.searchParams.set('language', language.trim());
  }

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
      return NextResponse.json({ success: false, error: 'Cloned voice not found.' }, { status: 404 });
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
    logger.error('[api/persona/cloned-voices/:id/preview] unreachable', error);
    return NextResponse.json({ success: false, error: 'Preview service unreachable.' }, { status: 502 });
  }
}

const POST_ROUTE = 'POST /api/persona/cloned-voices/[cloneId]/preview';

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, {
  getUserId: resolveReportingUserId,
});
