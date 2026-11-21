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
import { ListPromptsQuerySchema, PromptVisibilitySchema, type PromptSource, type PromptVisibility } from '@/lib/contracts/prompts';
import type { PromptListFilter } from '@/lib/prompt-search';
import type { PromptVersionRef } from '@/lib/prompt-versions';

export interface PromptCaller {
  userId: string | null;
  scopedKey: boolean;
}

function carriesCredentials(request: Request): boolean {
  return request.headers.has('authorization') || request.headers.has('x-api-key');
}

export async function resolvePromptCaller(
  request: Request,
  route: string,
  limit: RateLimitProfile,
  options: { allowAnonymous: boolean },
): Promise<PromptCaller | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error !== null || session.auth === null) {
    const anonymous =
      options.allowAnonymous && session.error?.status === 401 && !carriesCredentials(request);
    if (!anonymous) return session.error ?? apiErrorResponse(401, 'Unauthorized.', { route });
    const limited = await applyRateLimit(request, limit);
    if (limited) return limited;
    return { userId: null, scopedKey: false };
  }
  const limited = await applyRateLimit(request, limit, session.auth.userId);
  if (limited) return limited;
  return { userId: session.auth.userId, scopedKey: isScopedApiKey(session.auth) };
}

export function requireOwner(caller: PromptCaller, route: string): { userId: string } | NextResponse {
  if (caller.userId === null) return apiErrorResponse(401, 'Unauthorized.', { route });
  if (caller.scopedKey) {
    return apiErrorResponse(403, 'A persona-scoped API key cannot manage prompts.', {
      route,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
    });
  }
  return { userId: caller.userId };
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
  const parsed = schema.safeParse(raw);
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

export function slugTaken(route: string): NextResponse {
  return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_SLUG_TAKEN), {
    route,
    code: ERROR_CODES.PROMPT_SLUG_TAKEN,
    field: 'slug',
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
  visibility: PromptVisibility;
}

export function promptSummaryBody(row: UserPromptRow, source: PromptSource): PromptSummaryBody {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    source,
    visibility: PromptVisibilitySchema.parse(row.visibility),
  };
}

export type PromptDetailBody = PromptSummaryBody & { prompt: string; versionId: string; version: number };

export function promptDetailBody(row: UserPromptRow, source: PromptSource, version: PromptVersionRef): PromptDetailBody {
  return { ...promptSummaryBody(row, source), prompt: row.body, versionId: version.versionId, version: version.version };
}

export function readListFilter(request: Request, route: string): { ok: true; filter: PromptListFilter } | { ok: false; response: NextResponse } {
  const raw: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) raw[key] = value;
  const parsed = ListPromptsQuerySchema.safeParse(raw);
  if (parsed.success) return { ok: true, filter: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
  return {
    ok: false,
    response: apiErrorResponse(400, issue.message, { route, code: ERROR_CODES.VALIDATION_FAILED, field }),
  };
}
