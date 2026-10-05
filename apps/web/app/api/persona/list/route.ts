import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';
import { describeImageSource, toSameOriginAssetPath } from '@/lib/image-source';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// GET /api/persona/list — the logged-in user's personas.
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
// Foto e amostra de voz saem como signed URLs (bucket privado).
//---------------

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60; // 1h

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, personas: [], message: 'Authentication required.' },
      { status: 401 },
    );
  }

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from('personas')
    .select(
      'id, name, photo_path, avatar_url, voice_id, voice_audio_path, created_at, language, video_aspect, script_prompt, paragraph_number, niche, face_quality',
    )
    .eq('user_id', auth.userId);

  // A key with explicit scope only sees the authorized personas.
  if (isScopedApiKey(auth)) {
    query = query.in('id', auth.personaIds ?? []);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    logger.error('[api/persona/list] query failed', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list personas.' },
      { status: 500 },
    );
  }

  const personas = await Promise.all(
    (data ?? []).map(async (record) => ({
      id: record.id as string,
      name: record.name as string,
      createdAt: record.created_at as string,
      // Normalized to same-origin: rows created before this fix stored the
      // absolute production URL (the faces API hands out `${APP_URL}/...`),
      // so local dev fetched production — and an unauthenticated fetch of a
      // public asset is bounced to /landing by the middleware, i.e. HTML
      // where an image is expected. Third-party URLs stay untouched.
      avatarUrl: toSameOriginAssetPath(record.avatar_url as string | null) ?? undefined,
      photoUrl: await signedUrl(supabase, record.photo_path as string | null),
      voiceId: (record.voice_id as string | null) ?? undefined,
      voiceAudioUrl: await signedUrl(supabase, record.voice_audio_path as string | null),
      language: (record.language as string | null) ?? undefined,
      videoAspect: (record.video_aspect as string | null) ?? undefined,
      scriptPrompt: (record.script_prompt as string | null) ?? undefined,
      paragraphNumber: (record.paragraph_number as number | null) ?? undefined,
      niche: (record.niche as string | null) ?? undefined,
      faceQuality: (record.face_quality as string | null) ?? undefined,
    })),
  );

  //---------------
  // Avatar diagnostics. A missing face used to be invisible: the list answers
  // with no avatarUrl, the UI silently draws initials, and nobody can tell a
  // NULL column from a dead upstream URL. Logged per persona (redacted — the
  // storage signature lives in the query string) plus a one-line summary.
  //---------------
  for (const persona of personas) {
    const avatarSource = describeImageSource(persona.avatarUrl);
    if (avatarSource === null && persona.photoUrl === undefined) {
      logger.warn('[api/persona/list] persona has no avatar source', {
        personaId: persona.id,
        name: persona.name,
      });
      continue;
    }
    logger.debug('[api/persona/list] persona avatar source', {
      personaId: persona.id,
      avatarSource,
      hasPhoto: persona.photoUrl !== undefined,
    });
  }
  const withFace = personas.filter(
    (persona) => persona.avatarUrl !== undefined || persona.photoUrl !== undefined,
  ).length;
  logger.info('[api/persona/list] listed personas', {
    total: personas.length,
    withFace,
    withoutFace: personas.length - withFace,
  });

  return NextResponse.json({ authenticated: true, personas });
}

async function signedUrl(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  path: string | null,
): Promise<string | undefined> {
  if (!path) return undefined;
  const { data } = await supabase.storage
    .from('personas')
    .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);
  return data?.signedUrl;
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/list', getHandler);
