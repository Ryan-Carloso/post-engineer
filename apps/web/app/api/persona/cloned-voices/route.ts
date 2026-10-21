import { NextResponse } from 'next/server';

import { validateCloneReferenceBuffer } from '@/lib/cloned-voice-audio';
import { narrowClonedVoiceRow, type ClonedVoicePublicRow } from '@/lib/cloned-voices-types';
import { engineBaseUrl, parseEngineJson } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isEnglishLanguage, ONLY_ENGLISH_CLONE_MESSAGE } from '@/lib/language-gate';

const GET_ROUTE = 'GET /api/persona/cloned-voices';
const POST_ROUTE = 'POST /api/persona/cloned-voices';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });
    const payload = await parseEngineJson(upstream);
    if (!upstream.ok) {
      logger.error('[api/persona/cloned-voices] list upstream error', undefined, { status: upstream.status });
      return NextResponse.json({ success: false, error: 'Cloned voices unavailable.' }, { status: 502 });
    }
    const body =
      typeof payload === 'object' && payload !== null && 'body' in payload
        ? (payload as { body?: unknown }).body
        : null;
    if (!Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid cloned voices payload.' }, { status: 502 });
    }
    const voices = body
      .map(narrowClonedVoiceRow)
      .filter((row): row is ClonedVoicePublicRow => row !== null);
    return NextResponse.json({ success: true, voices });
  } catch (error) {
    logger.error('[api/persona/cloned-voices] list unreachable', error);
    return NextResponse.json({ success: false, error: 'Cloned voices service unreachable.' }, { status: 502 });
  }
}

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voiceCloneCreate, auth.userId);
  if (limited) {
    return limited;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart body.' }, { status: 400 });
  }

  const consent = formData.get('consent');
  const language = formData.get('language');
  const fileEntry = formData.get('file');
  if (consent !== 'true') {
    return NextResponse.json({ success: false, error: 'Voice cloning consent is required.' }, { status: 400 });
  }
  if (typeof language !== 'string' || !language.trim()) {
    return NextResponse.json({ success: false, error: 'Language is required.' }, { status: 400 });
  }
  // English-only launch: cloning only ever worked well in English. The
  // engine enforces the same rule; rejecting here saves the round-trip.
  if (!isEnglishLanguage(language)) {
    return NextResponse.json({ success: false, error: ONLY_ENGLISH_CLONE_MESSAGE }, { status: 400 });
  }
  if (typeof fileEntry === 'string' || fileEntry === null) {
    return NextResponse.json({ success: false, error: 'Reference audio file is required.' }, { status: 400 });
  }
  const file = fileEntry as File;
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateCloneReferenceBuffer(buffer);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  const upstreamForm = new FormData();
  upstreamForm.set('consent', 'true');
  upstreamForm.set('language', language.trim());
  upstreamForm.set('file', new Blob([buffer], { type: file.type || 'application/octet-stream' }), file.name || 'reference.bin');

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices`, {
      method: 'POST',
      headers: engineAuthHeaders(auth.userId),
      body: upstreamForm,
    });
    const payload = await parseEngineJson(upstream);
    if (!upstream.ok) {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof (payload as { message?: unknown }).message === 'string'
          ? (payload as { message: string }).message
          : 'Could not start voice clone.';
      return NextResponse.json({ success: false, error: message }, { status: upstream.status });
    }
    const body =
      typeof payload === 'object' && payload !== null && 'body' in payload
        ? (payload as { body?: unknown }).body
        : null;
    const row = narrowClonedVoiceRow(body);
    if (row === null) {
      return NextResponse.json({ success: false, error: 'Invalid clone response.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, voice: row }, { status: upstream.status });
  } catch (error) {
    logger.error('[api/persona/cloned-voices] create unreachable', error);
    return NextResponse.json({ success: false, error: 'Cloned voices service unreachable.' }, { status: 502 });
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, {
  getUserId: resolveReportingUserId,
});

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, {
  getUserId: resolveReportingUserId,
});
