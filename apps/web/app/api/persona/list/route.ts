import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';
import { toSameOriginAssetPath } from '@/lib/image-source';
import { PERSONA_PHOTO_BUCKET } from '@/lib/persona-photo';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  emptyPersonaDefaultAccounts,
  getPersonaDefaultAccountsForPersonas,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller } from '@/lib/rate-limit';

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60;

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, personas: [], message: 'Authentication required.' },
      { status: 401 },
    );
  }
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.personaList), auth.userId);
  if (limited) return limited;

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from('personas')
    .select('id, name, photo_path, avatar_url, created_at, ai_label')
    .eq('user_id', auth.userId);

  const scopedIds = auth.personaIds;
  if (isScopedApiKey(auth) && scopedIds) {
    query = query.in('id', scopedIds);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    logger.error('[api/persona/list] query failed', error.message);
    return NextResponse.json(
      { success: false, error: 'Failed to list personas.' },
      { status: 500 },
    );
  }

  const records = data === null || data === undefined ? [] : data;
  const personaIds = records.map((record) => record.id);

  let bindingsByPersona: Map<string, PersonaDefaultAccounts> = new Map();
  if (personaIds.length > 0) {
    try {
      bindingsByPersona = await getPersonaDefaultAccountsForPersonas(supabase, personaIds);
    } catch (error) {
      logger.error(
        '[api/persona/list] persona_default_accounts query failed',
        error instanceof Error ? error.message : 'unknown error',
      );
      return NextResponse.json(
        { success: false, error: 'Failed to list personas.' },
        { status: 500 },
      );
    }
  }

  const personas = await Promise.all(
    records.map(async (record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.created_at,
      avatarUrl: toSameOriginAssetPath(record.avatar_url) ?? undefined,
      photoUrl: await signedPhotoUrl(supabase, record.photo_path),
      aiLabel: record.ai_label === true,
      boundAccounts: bindingsByPersona.get(record.id) ?? emptyPersonaDefaultAccounts(),
    })),
  );

  return NextResponse.json({ authenticated: true, personas });
}

async function signedPhotoUrl(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  path: string | null,
): Promise<string | undefined> {
  if (path === null || path === '') return undefined;
  const { data, error } = await supabase.storage
    .from(PERSONA_PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);
  if (error || data === null || data === undefined || !data.signedUrl) {
    logger.error('[api/persona/list] photo sign failed', error?.message ?? 'missing signedUrl');
    return undefined;
  }
  return data.signedUrl;
}

export const GET = withApiErrorReporting('GET /api/persona/list', getHandler, { getUserId: resolveReportingUserId });
