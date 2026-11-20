import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { ReviewPromptBodySchema } from '@/lib/contracts/prompts';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { isUuid } from '@/lib/schedule-slot-id';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { reviewUserPrompt } from '@/lib/user-prompts';
import { promptNotFound, readJsonBody, resolveReviewer, storeFailure } from '@/lib/user-prompts-http';

type RouteContext = { params: Promise<{ id: string }> };

const ROUTE = 'POST /api/admin/prompts/[id]/review';

async function postHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const reviewer = await resolveReviewer(request, ROUTE, RATE_LIMITS.promptsReview);
  if (reviewer instanceof NextResponse) return reviewer;

  const { id: rawId } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return apiErrorResponse(400, 'Malformed prompt id.', { route: ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const parsed = await readJsonBody(request, ReviewPromptBodySchema, ROUTE);
  if (!parsed.ok) return parsed.response;
  const { decision, contentHash, reason } = parsed.body;
  if (decision === 'reject' && reason === undefined) {
    return apiErrorResponse(400, 'reason: a rejection needs a reason the owner can read.', {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'reason',
    });
  }
  if (!isUuid(id)) return promptNotFound(ROUTE);

  try {
    const outcome = await reviewUserPrompt(createSupabaseServiceClient(), {
      id,
      reviewerId: reviewer.userId,
      contentHash,
      decision,
      reason,
    });
    if (outcome.kind === 'not_found') return promptNotFound(ROUTE);
    if (outcome.kind === 'stale') {
      return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_REVIEW_STALE), {
        route: ROUTE,
        code: ERROR_CODES.PROMPT_REVIEW_STALE,
      });
    }
    if (outcome.kind === 'slug_taken') {
      return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_SLUG_TAKEN), {
        route: ROUTE,
        code: ERROR_CODES.PROMPT_SLUG_TAKEN,
      });
    }
    return NextResponse.json({ success: true, slug: outcome.row.slug, status: outcome.row.status });
  } catch (error) {
    return storeFailure(ROUTE, error);
  }
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
