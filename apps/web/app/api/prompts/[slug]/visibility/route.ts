import { NextResponse, after } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { SetPromptVisibilityBodySchema, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { notifyReviewersOfPendingPrompt } from '@/lib/prompt-review-mail';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requestPublication, withdrawPublication } from '@/lib/user-prompts';
import {
  promptDetailBody,
  promptNotFound,
  readJsonBody,
  resolvePromptCaller,
  scopedKeyDenied,
  storeFailure,
} from '@/lib/user-prompts-http';

type RouteContext = { params: Promise<{ slug: string }> };

const ROUTE = 'POST /api/prompts/[slug]/visibility';

async function postHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, ROUTE, RATE_LIMITS.promptsWrite);
  if (caller instanceof NextResponse) return caller;
  if (caller.scopedKey) return scopedKeyDenied(ROUTE);

  const { slug: rawSlug } = await context.params;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return apiErrorResponse(400, 'Malformed prompt slug.', { route: ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const parsed = await readJsonBody(request, SetPromptVisibilityBodySchema, ROUTE);
  if (!parsed.ok) return parsed.response;
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(ROUTE);

  try {
    const db = createSupabaseServiceClient();
    const outcome =
      parsed.body.visibility === 'public'
        ? await requestPublication(db, caller.userId, slug)
        : await withdrawPublication(db, caller.userId, slug);
    if (outcome.kind === 'not_found') return promptNotFound(ROUTE);
    if (outcome.kind === 'conflict') {
      return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_STATE_CONFLICT), {
        route: ROUTE,
        code: ERROR_CODES.PROMPT_STATE_CONFLICT,
        extra: { status: outcome.status },
      });
    }
    if (parsed.body.visibility === 'public' && outcome.changed) {
      const notice = { slug: outcome.row.slug, title: outcome.row.title };
      after(() => notifyReviewersOfPendingPrompt(notice));
    }
    return NextResponse.json({ success: true, prompt: promptDetailBody(outcome.row, 'own') });
  } catch (error) {
    return storeFailure(ROUTE, error);
  }
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
