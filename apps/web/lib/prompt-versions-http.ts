import 'server-only';

import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import {
  ListPromptVersionsQuerySchema,
  PROMPT_VERSION_LIST_LIMITS,
  PROMPT_VERSION_PATTERN,
} from '@/lib/contracts/prompts';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';

export function readVersionSegment(rawVersion: string, route: string): number | NextResponse {
  let version: string;
  try {
    version = decodeURIComponent(rawVersion);
  } catch {
    return apiErrorResponse(400, 'Malformed prompt version.', { route, code: ERROR_CODES.VALIDATION_FAILED, field: 'version' });
  }
  if (!PROMPT_VERSION_PATTERN.test(version)) {
    return apiErrorResponse(400, 'version: use a positive whole number.', {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'version',
    });
  }
  return Number(version);
}

export function readVersionsQuery(
  request: Request,
  route: string,
): { limit: number; before?: number } | NextResponse {
  const raw: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) raw[key] = value;
  const parsed = ListPromptVersionsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
    return apiErrorResponse(400, field === undefined ? issue.message : `${field}: ${issue.message}`, {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field,
    });
  }
  const { limit, before } = parsed.data;
  return { limit: limit ?? PROMPT_VERSION_LIST_LIMITS.default, ...(before === undefined ? {} : { before }) };
}

export function promptVersionNotFound(route: string): NextResponse {
  return apiErrorResponse(404, errorMessage(ERROR_CODES.PROMPT_VERSION_NOT_FOUND), {
    route,
    code: ERROR_CODES.PROMPT_VERSION_NOT_FOUND,
  });
}

export function promptVersionConflict(route: string): NextResponse {
  return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_VERSION_CONFLICT), {
    route,
    code: ERROR_CODES.PROMPT_VERSION_CONFLICT,
  });
}
