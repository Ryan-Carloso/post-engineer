import 'server-only';

import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { apiErrorResponse } from '@/lib/api-error';
import { isScopedApiKey } from '@/lib/api-keys';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { applyRateLimit, type RateLimitProfile } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { UserPromptStoreError, type UserPromptRow } from '@/lib/user-prompts';
import { UserPromptStatusSchema, type PromptSource, type UserPromptStatus } from '@/lib/contracts/prompts';
import { isPromptReviewer, PromptReviewerConfigError } from '@/lib/prompt-reviewers';

export interface PromptCaller {
  userId: string;
  scopedKey: boolean;
}

export async function resolvePromptCaller(
  request: Request,
  route: string,
  limit: RateLimitProfile,
): Promise<PromptCaller | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error !== null || session.auth === null) {
    return session.error ?? apiErrorResponse(401, 'Unauthorized.', { route });
  }
  const limited = await applyRateLimit(request, limit, session.auth.userId);
  if (limited) return limited;
  return { userId: session.auth.userId, scopedKey: isScopedApiKey(session.auth) };
}

export function scopedKeyDenied(route: string): NextResponse {
  return apiErrorResponse(403, 'A persona-scoped API key cannot manage prompts.', {
    route,
    code: ERROR_CODES.PERSONA_SCOPE_DENIED,
  });
}

export type BodyOutcome<Body> = { ok: true; body: Body } | { ok: false; response: NextResponse };

export async function readJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  route: string,
): Promise<BodyOutcome<z.output<Schema>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiErrorResponse(400, 'Request body must be valid JSON.', {
        route,
        code: ERROR_CODES.VALIDATION_FAILED,
      }),
    };
  }
  return parseBody(schema, raw, route);
}

function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  route: string,
): BodyOutcome<z.output<Schema>> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, body: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
  return {
    ok: false,
    response: apiErrorResponse(400, field === undefined ? issue.message : `${field}: ${issue.message}`, {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field,
    }),
  };
}

export function promptNotFound(route: string): NextResponse {
  return apiErrorResponse(404, errorMessage(ERROR_CODES.PROMPT_NOT_FOUND), {
    route,
    code: ERROR_CODES.PROMPT_NOT_FOUND,
  });
}

export function storeFailure(route: string, error: unknown): NextResponse {
  if (error instanceof UserPromptStoreError) {
    logger.error('[user-prompts] store failed', error, { route });
  } else {
    logger.error('[user-prompts] unexpected failure', error, { route });
  }
  return apiErrorResponse(500, errorMessage(ERROR_CODES.INTERNAL_ERROR), {
    route,
    code: ERROR_CODES.INTERNAL_ERROR,
    leaveReportingToWrapper: true,
  });
}

export interface PromptSummaryBody {
  slug: string;
  title: string;
  description: string;
  source: PromptSource;
  status: UserPromptStatus | null;
  rejectionReason: string | null;
}

export function promptSummaryBody(row: UserPromptRow, source: PromptSource): PromptSummaryBody {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    source,
    status: source === 'own' ? UserPromptStatusSchema.parse(row.status) : null,
    rejectionReason: source === 'own' ? row.rejection_reason : null,
  };
}

export function promptDetailBody(row: UserPromptRow, source: PromptSource): PromptSummaryBody & { prompt: string } {
  return { ...promptSummaryBody(row, source), prompt: row.body };
}

export async function resolveReviewer(
  request: Request,
  route: string,
  limit: RateLimitProfile,
): Promise<{ userId: string } | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error !== null || session.auth === null) {
    return session.error ?? apiErrorResponse(401, 'Unauthorized.', { route });
  }
  const limited = await applyRateLimit(request, limit, session.auth.userId);
  if (limited) return limited;
  try {
    if (!isPromptReviewer(session.auth)) {
      return apiErrorResponse(403, errorMessage(ERROR_CODES.PROMPT_REVIEWER_REQUIRED), {
        route,
        code: ERROR_CODES.PROMPT_REVIEWER_REQUIRED,
      });
    }
  } catch (error) {
    if (error instanceof PromptReviewerConfigError) {
      logger.error('[user-prompts] reviewer list is not configured', error, { route });
      return apiErrorResponse(500, 'Prompt review is not configured on this server.', {
        route,
        code: ERROR_CODES.INTERNAL_ERROR,
        leaveReportingToWrapper: true,
      });
    }
    throw error;
  }
  return { userId: session.auth.userId };
}
