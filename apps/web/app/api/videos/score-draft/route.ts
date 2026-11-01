//---------------
// POST /api/videos/score-draft — mechanical draft scoring.
//
// Scores one draft against the caller's own measured posts (post_metrics)
// and runs the publish check for the requested network (linkedin,
// youtube, instagram, bluesky). It never debits tokens, never
// schedules, never calls the engine: there is no database write and no
// external call on this path at all — the baseline is one capped read
// of the caller's own rows, plus one ownership read when personaId is given.
//
// A script (kind: 'script') gets `publishCheck: null`: caption limits do not
// apply to spoken text. A failing publish check does NOT make this route 400: scoring is
// advisory, and the caller (agent or UI) decides whether to fix the
// draft. The check result is in the response as `publishCheck`, with
// `ok: false` and the exact failures, so a pre-publish gate can block
// on it without this route inventing a second error contract.
//---------------

import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { UUID } from '@/lib/metrics/metrics-query';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  BASELINE_ROW_LIMIT,
  DRAFT_KINDS,
  DRAFT_MAX_INPUT_CHARS,
  PUBLISH_NETWORKS,
  scoreDraft,
  summarizeBaseline,
  type BaselineRow,
  type DraftKind,
  type PublishNetwork,
} from '@/lib/draft-scoring';

const ROUTE = 'POST /api/videos/score-draft';

interface ScoreDraftBody {
  draft: string;
  network?: PublishNetwork;
  personaId?: string;
  kind?: DraftKind;
}

function parseBody(body: unknown): ScoreDraftBody | NextResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return apiErrorResponse(400, 'Request body must be an object.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      route: ROUTE,
    });
  }
  const record = body as Record<string, unknown>;
  const draft = record.draft;
  if (typeof draft !== 'string' || draft.trim().length === 0) {
    return apiErrorResponse(400, 'draft is required and must be a non-empty string.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'draft',
      route: ROUTE,
    });
  }
  if (draft.length > DRAFT_MAX_INPUT_CHARS) {
    return apiErrorResponse(400, `draft must be at most ${DRAFT_MAX_INPUT_CHARS} characters.`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'draft',
      route: ROUTE,
    });
  }
  const network = record.network;
  if (
    network !== undefined
    && (typeof network !== 'string' || !(PUBLISH_NETWORKS as string[]).includes(network))
  ) {
    return apiErrorResponse(400, 'network must be one of "linkedin", "youtube", "instagram", "bluesky" when given.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'network',
      route: ROUTE,
    });
  }
  const personaId = record.personaId;
  if (personaId !== undefined && (typeof personaId !== 'string' || !UUID.test(personaId))) {
    return apiErrorResponse(400, 'personaId must be a uuid when given.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
      route: ROUTE,
    });
  }
  const kind = record.kind;
  if (kind !== undefined && (typeof kind !== 'string' || !(DRAFT_KINDS as string[]).includes(kind))) {
    return apiErrorResponse(400, 'kind must be "post" or "script" when given.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'kind',
      route: ROUTE,
    });
  }
  return {
    draft,
    kind: typeof kind === 'string' ? (kind as DraftKind) : undefined,
    network: typeof network === 'string' ? (network as PublishNetwork) : undefined,
    personaId: typeof personaId === 'string' ? personaId : undefined,
  };
}

// A persona that is out of the key's scope, missing or someone else's must
// not score as "no measured posts yet": the caller could not tell a bad id
// from a new persona.
async function personaAccessError(
  personaIds: string[] | null | undefined,
  userId: string,
  personaId: string,
): Promise<NextResponse | null> {
  if (!isPersonaAllowed(personaIds, personaId)) {
    return apiErrorResponse(403, 'This API key does not have access to this persona.', { route: ROUTE });
  }
  const { error } = await createSupabaseServiceClient()
    .from('personas')
    .select('id')
    .eq('id', personaId)
    // Ownership: service role bypasses RLS.
    .eq('user_id', userId)
    .single();
  if (error === null) return null;
  if (error.code === 'PGRST116') {
    return apiErrorResponse(404, 'Persona not found.', { route: ROUTE });
  }
  return apiErrorResponse(500, 'Failed to load persona.', { route: ROUTE, cause: error });
}

async function loadBaseline(
  userId: string,
  personaId: string | undefined,
  network: PublishNetwork | undefined,
  isScoped: boolean,
  scopedPersonaIds: string[],
): Promise<{ rows: BaselineRow[]; truncated: boolean } | null> {
  const supabase = createSupabaseServiceClient();
  // Prefer the 7d window (a full week of signal); fall back to 24h only
  // when the week has no measured rows at all, so a new account still
  // gets a baseline instead of an empty one.
  for (const window of ['7d', '24h'] as const) {
    let select = supabase
      .from('post_metrics')
      .select('script_angle, views, likes, comments, saves')
      // Ownership: service role bypasses RLS.
      .eq('user_id', userId)
      .eq('metrics_window', window);
    if (isScoped) {
      const ids = scopedPersonaIds.filter((id) => UUID.test(id));
      select = ids.length > 0
        ? select.or(`persona_id.in.(${ids.join(',')}),persona_id.is.null`)
        : select.is('persona_id', null);
    }
    if (personaId !== undefined) select = select.eq('persona_id', personaId);
    // Filter by network only when one was requested: omitting it keeps
    // the all-networks baseline the route had before.
    if (network !== undefined) select = select.eq('provider', network);
    const { data, error } = await select
      .order('collected_at', { ascending: false })
      .order('id', { ascending: true })
      // One extra row reveals whether the cap cut anything.
      .limit(BASELINE_ROW_LIMIT + 1);
    if (error) {
      logger.error('[score-draft] baseline query failed', error, { userId, window });
      return null;
    }
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      const kept = rows.slice(0, BASELINE_ROW_LIMIT).map((row) => ({
        scriptAngle: typeof row.script_angle === 'string' ? row.script_angle : null,
        views: typeof row.views === 'number' ? row.views : null,
        likes: typeof row.likes === 'number' ? row.likes : null,
        comments: typeof row.comments === 'number' ? row.comments : null,
        saves: typeof row.saves === 'number' ? row.saves : null,
      }));
      return { rows: kept, truncated: rows.length > BASELINE_ROW_LIMIT };
    }
  }
  return { rows: [], truncated: false };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.draftScore, auth.userId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      route: ROUTE,
    });
  }
  const parsed = parseBody(body);
  if (parsed instanceof NextResponse) return parsed;

  if (parsed.personaId !== undefined) {
    const accessError = await personaAccessError(auth.personaIds, auth.userId, parsed.personaId);
    if (accessError !== null) return accessError;
  }

  const loaded = await loadBaseline(
    auth.userId,
    parsed.personaId,
    parsed.network,
    isScopedApiKey(auth),
    auth.personaIds ?? [],
  );
  if (loaded === null) {
    return apiErrorResponse(500, 'Failed to load baseline metrics.', {
      route: ROUTE,
      cause: new Error('post_metrics query failed'),
    });
  }
  const result = scoreDraft(parsed.draft, summarizeBaseline(loaded.rows, loaded.truncated), parsed.network, parsed.kind);
  return NextResponse.json({ success: true, ...result });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
