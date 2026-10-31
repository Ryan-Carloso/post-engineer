//---------------
// POST /api/videos/score-draft — mechanical LinkedIn draft scoring.
//
// Scores one draft against the caller's own measured posts (post_metrics)
// and runs the LinkedIn publish check. It never debits tokens, never
// schedules, never calls the engine: there is no database write and no
// external call on this path at all — the baseline is one capped read
// of the caller's own rows.
//
// A failing publish check does NOT make this route 400: scoring is
// advisory, and the caller (agent or UI) decides whether to fix the
// draft. The check result is in the response as `publishCheck`, with
// `ok: false` and the exact failures, so a pre-publish gate can block
// on it without this route inventing a second error contract.
//---------------

import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  BASELINE_ROW_LIMIT,
  DRAFT_MAX_INPUT_CHARS,
  scoreDraft,
  summarizeBaseline,
  type BaselineRow,
} from '@/lib/draft-scoring';

const ROUTE = 'POST /api/videos/score-draft';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScoreDraftBody {
  draft: string;
  provider?: string;
  personaId?: string;
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
  const provider = record.provider;
  if (provider !== undefined && provider !== 'linkedin') {
    return apiErrorResponse(400, 'provider must be "linkedin" when given; only LinkedIn drafts are scored.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'provider',
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
  return {
    draft,
    provider: provider === 'linkedin' ? 'linkedin' : undefined,
    personaId: typeof personaId === 'string' ? personaId : undefined,
  };
}

async function loadBaseline(
  userId: string,
  personaId: string | undefined,
  isScoped: boolean,
  scopedPersonaIds: string[],
): Promise<BaselineRow[] | null> {
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
    const { data, error } = await select
      .order('collected_at', { ascending: false })
      .limit(BASELINE_ROW_LIMIT);
    if (error) {
      logger.error('[score-draft] baseline query failed', error, { userId, window });
      return null;
    }
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      return rows.map((row) => ({
        scriptAngle: typeof row.script_angle === 'string' ? row.script_angle : null,
        views: typeof row.views === 'number' ? row.views : null,
        likes: typeof row.likes === 'number' ? row.likes : null,
        comments: typeof row.comments === 'number' ? row.comments : null,
        saves: typeof row.saves === 'number' ? row.saves : null,
      }));
    }
  }
  return [];
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

  const rows = await loadBaseline(
    auth.userId,
    parsed.personaId,
    isScopedApiKey(auth),
    auth.personaIds ?? [],
  );
  if (rows === null) {
    return apiErrorResponse(500, 'Failed to load baseline metrics.', {
      route: ROUTE,
      cause: new Error('post_metrics query failed'),
    });
  }
  const result = scoreDraft(parsed.draft, summarizeBaseline(rows));
  return NextResponse.json({ success: true, ...result });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
