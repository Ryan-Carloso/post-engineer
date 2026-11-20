import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { UpdateUserPromptBodySchema, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';
import { ERROR_CODES } from '@/lib/error-codes';
import { findHubPrompt } from '@/lib/recipes/hub-prompts';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  deleteOwnUserPrompt,
  findApprovedUserPrompt,
  findOwnUserPrompt,
  updateOwnUserPrompt,
} from '@/lib/user-prompts';
import {
  promptDetailBody,
  promptNotFound,
  readJsonBody,
  resolvePromptCaller,
  scopedKeyDenied,
  storeFailure,
} from '@/lib/user-prompts-http';

type RouteContext = { params: Promise<{ slug: string }> };

const GET_ROUTE = 'GET /api/prompts/[slug]';
const PATCH_ROUTE = 'PATCH /api/prompts/[slug]';
const DELETE_ROUTE = 'DELETE /api/prompts/[slug]';

async function readSlug(context: RouteContext, route: string): Promise<string | NextResponse> {
  const { slug: rawSlug } = await context.params;
  try {
    return decodeURIComponent(rawSlug);
  } catch {
    return apiErrorResponse(400, 'Malformed prompt slug.', { route, code: ERROR_CODES.VALIDATION_FAILED });
  }
}

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, GET_ROUTE, RATE_LIMITS.promptsRead);
  if (caller instanceof NextResponse) return caller;
  const slug = await readSlug(context, GET_ROUTE);
  if (slug instanceof NextResponse) return slug;

  const official = findHubPrompt(slug);
  if (official !== null) {
    return NextResponse.json({
      success: true,
      prompt: { ...official, source: 'official', status: null, rejectionReason: null },
    });
  }
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(GET_ROUTE);

  try {
    const db = createSupabaseServiceClient();
    const own = caller.scopedKey ? null : await findOwnUserPrompt(db, caller.userId, slug);
    if (own !== null) return NextResponse.json({ success: true, prompt: promptDetailBody(own, 'own') });
    const community = await findApprovedUserPrompt(db, slug);
    if (community === null) return promptNotFound(GET_ROUTE);
    return NextResponse.json({ success: true, prompt: promptDetailBody(community, 'community') });
  } catch (error) {
    return storeFailure(GET_ROUTE, error);
  }
}

async function patchHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, PATCH_ROUTE, RATE_LIMITS.promptsWrite);
  if (caller instanceof NextResponse) return caller;
  if (caller.scopedKey) return scopedKeyDenied(PATCH_ROUTE);
  const slug = await readSlug(context, PATCH_ROUTE);
  if (slug instanceof NextResponse) return slug;
  const parsed = await readJsonBody(request, UpdateUserPromptBodySchema, PATCH_ROUTE);
  if (!parsed.ok) return parsed.response;
  if (Object.keys(parsed.body).length === 0) {
    return apiErrorResponse(400, 'Send at least one of title, description or prompt.', {
      route: PATCH_ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(PATCH_ROUTE);
  try {
    const row = await updateOwnUserPrompt(createSupabaseServiceClient(), caller.userId, slug, parsed.body);
    if (row === null) return promptNotFound(PATCH_ROUTE);
    return NextResponse.json({ success: true, prompt: promptDetailBody(row, 'own') });
  } catch (error) {
    return storeFailure(PATCH_ROUTE, error);
  }
}

async function deleteHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, DELETE_ROUTE, RATE_LIMITS.promptsWrite);
  if (caller instanceof NextResponse) return caller;
  if (caller.scopedKey) return scopedKeyDenied(DELETE_ROUTE);
  const slug = await readSlug(context, DELETE_ROUTE);
  if (slug instanceof NextResponse) return slug;
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(DELETE_ROUTE);
  try {
    const deleted = await deleteOwnUserPrompt(createSupabaseServiceClient(), caller.userId, slug);
    if (!deleted) return promptNotFound(DELETE_ROUTE);
    return NextResponse.json({ success: true });
  } catch (error) {
    return storeFailure(DELETE_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting(PATCH_ROUTE, patchHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting(DELETE_ROUTE, deleteHandler, { getUserId: resolveReportingUserId });
