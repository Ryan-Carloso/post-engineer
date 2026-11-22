import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { SITE_URL } from '@/lib/seo';
import { UUID } from '@/lib/metrics/metrics-query';
import { CreateShareLinkBodySchema, SHARE_LINK_MAX_ACTIVE } from '@/lib/contracts/share-links';
import { generateShareToken, hashShareToken, sharePathFor } from '@/lib/share-links/token';
import { presentShareLink, type ShareLinkView } from '@/lib/share-links/present';

const SCOPED_KEY_ERROR = 'A persona-scoped API key cannot manage share links.';
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

function rejectScopedKey(route: string, auth: Parameters<typeof isScopedApiKey>[0]): NextResponse | null {
  if (!isScopedApiKey(auth)) return null;
  return apiErrorResponse(403, SCOPED_KEY_ERROR, { route });
}

async function readBody(request: Request): Promise<{ ok: true; json: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.trim().length === 0) return { ok: true, json: {} };
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const scoped = rejectScopedKey('GET /api/share-links', auth);
  if (scoped !== null) return scoped;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('share_links')
    .select('id, persona_ids, created_at, expires_at, revoked_at, last_viewed_at')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    return apiErrorResponse(500, 'Failed to list share links.', { route: 'GET /api/share-links', cause: error });
  }
  const links: ShareLinkView[] = [];
  for (const row of data ?? []) {
    const link = presentShareLink(row);
    if (link === null) {
      logger.error('[api/share-links] skipped an unreadable share link row', new Error('unreadable share_links row'));
      continue;
    }
    links.push(link);
  }
  return NextResponse.json({ success: true, links });
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.shareLinkManage);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const scoped = rejectScopedKey('POST /api/share-links', auth);
  if (scoped !== null) return scoped;

  const body = await readBody(request);
  if (!body.ok) return apiErrorResponse(400, 'Body must be valid JSON.', { route: 'POST /api/share-links' });
  const parsed = CreateShareLinkBodySchema.safeParse(body.json);
  if (!parsed.success) {
    return apiErrorResponse(400, 'Invalid share link request.', {
      route: 'POST /api/share-links',
      logMessage: 'Invalid share link body.',
      metadata: { detail: parsed.error.issues[0]?.message.slice(0, 200) },
    });
  }
  const { personaIds, expiresInDays } = parsed.data;
  if (personaIds !== undefined) {
    const valid = personaIds.every((id) => UUID.test(id)) && new Set(personaIds).size === personaIds.length;
    if (!valid) {
      return apiErrorResponse(400, 'personaIds must be distinct persona IDs.', { route: 'POST /api/share-links' });
    }
  }

  const supabase = createSupabaseServiceClient();
  if (personaIds !== undefined) {
    const { data: owned, error: ownedError } = await supabase
      .from('personas')
      .select('id')
      .eq('user_id', auth.userId)
      .in('id', personaIds);
    if (ownedError) {
      return apiErrorResponse(500, 'Failed to create the share link.', { route: 'POST /api/share-links', cause: ownedError });
    }
    const ownedIds = new Set((owned ?? []).map((persona) => persona.id as string));
    if (personaIds.some((id) => !ownedIds.has(id))) {
      return apiErrorResponse(404, 'Persona not found.', { route: 'POST /api/share-links' });
    }
  }

  const token = generateShareToken();
  const expiresAt = expiresInDays === undefined ? null : new Date(Date.now() + expiresInDays * DAY_MS).toISOString();
  const { data, error } = await supabase.rpc('create_share_link', {
    p_user_id: auth.userId,
    p_token_hash: hashShareToken(token),
    p_persona_ids: personaIds ?? null,
    p_expires_at: expiresAt,
    p_max: SHARE_LINK_MAX_ACTIVE,
  });
  if (error) {
    return apiErrorResponse(500, 'Failed to create the share link.', { route: 'POST /api/share-links', cause: error });
  }
  const created: unknown = Array.isArray(data) ? data[0] : undefined;
  if (created === undefined) {
    return apiErrorResponse(409, `You already have ${SHARE_LINK_MAX_ACTIVE} active share links. Revoke one first.`, {
      route: 'POST /api/share-links',
      code: 'SHARE_LINK_LIMIT',
    });
  }
  const link = presentShareLink(created);
  if (link === null) {
    return apiErrorResponse(500, 'Failed to create the share link.', {
      route: 'POST /api/share-links',
      cause: new Error('create_share_link returned an unreadable row'),
    });
  }

  const path = sharePathFor(token);
  return NextResponse.json(
    {
      success: true,
      id: link.id,
      token,
      path,
      url: `${SITE_URL}${path}`,
      personaIds: link.personaIds,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = withApiErrorReporting('GET /api/share-links', getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting('POST /api/share-links', postHandler, { getUserId: resolveReportingUserId });
