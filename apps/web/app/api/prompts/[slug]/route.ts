import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { UpdateUserPromptBodySchema, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';
import { ERROR_CODES } from '@/lib/error-codes';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  deleteOwnUserPrompt,
  findOwnUserPrompt,
  findPublicUserPrompt,
  updateOwnUserPrompt,
} from '@/lib/user-prompts';
import { currentUserPromptVersion } from '@/lib/prompt-versions';
import {
  promptDetailBody,
  promptNotFound,
  readJsonBody,
  readPromptSlug,
  requireOwner,
  resolvePromptCaller,
  slugTaken,
  storeFailure,
} from '@/lib/user-prompts-http';

type RouteContext = { params: Promise<{ slug: string }> };

const GET_ROUTE = 'GET /api/prompts/[slug]';
const PATCH_ROUTE = 'PATCH /api/prompts/[slug]';
const DELETE_ROUTE = 'DELETE /api/prompts/[slug]';

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, GET_ROUTE, RATE_LIMITS.promptsRead, { allowAnonymous: true });
  if (caller instanceof NextResponse) return caller;
  const slug = await readPromptSlug(context.params, GET_ROUTE);
  if (slug instanceof NextResponse) return slug;

  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(GET_ROUTE);

  try {
    const db = createSupabaseServiceClient();
    const own = caller.userId === null || caller.scopedKey ? null : await findOwnUserPrompt(db, caller.userId, slug);
    if (own !== null) {
      return NextResponse.json({ success: true, prompt: promptDetailBody(own, 'own', await currentUserPromptVersion(db, own.id)) });
    }
    const community = await findPublicUserPrompt(db, slug);
    if (community === null) return promptNotFound(GET_ROUTE);
    return NextResponse.json({
      success: true,
      prompt: promptDetailBody(community, 'community', await currentUserPromptVersion(db, community.id)),
    });
  } catch (error) {
    return storeFailure(GET_ROUTE, error);
  }
}

async function patchHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, PATCH_ROUTE, RATE_LIMITS.promptsWrite, { allowAnonymous: false });
  if (caller instanceof NextResponse) return caller;
  const owner = requireOwner(caller, PATCH_ROUTE);
  if (owner instanceof NextResponse) return owner;
  const slug = await readPromptSlug(context.params, PATCH_ROUTE);
  if (slug instanceof NextResponse) return slug;
  const parsed = await readJsonBody(request, UpdateUserPromptBodySchema, PATCH_ROUTE);
  if (!parsed.ok) return parsed.response;
  if (Object.keys(parsed.body).length === 0) {
    return apiErrorResponse(400, 'Send at least one of title, description, prompt or visibility.', {
      route: PATCH_ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(PATCH_ROUTE);
  try {
    const db = createSupabaseServiceClient();
    const outcome = await updateOwnUserPrompt(db, owner.userId, slug, parsed.body);
    if (outcome.kind === 'not_found') return promptNotFound(PATCH_ROUTE);
    if (outcome.kind === 'slug_taken') return slugTaken(PATCH_ROUTE);
    const version = await currentUserPromptVersion(db, outcome.row.id);
    return NextResponse.json({ success: true, prompt: promptDetailBody(outcome.row, 'own', version) });
  } catch (error) {
    return storeFailure(PATCH_ROUTE, error);
  }
}

async function deleteHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, DELETE_ROUTE, RATE_LIMITS.promptsWrite, { allowAnonymous: false });
  if (caller instanceof NextResponse) return caller;
  const owner = requireOwner(caller, DELETE_ROUTE);
  if (owner instanceof NextResponse) return owner;
  const slug = await readPromptSlug(context.params, DELETE_ROUTE);
  if (slug instanceof NextResponse) return slug;
  if (!USER_PROMPT_SLUG_PATTERN.test(slug)) return promptNotFound(DELETE_ROUTE);
  try {
    const deleted = await deleteOwnUserPrompt(createSupabaseServiceClient(), owner.userId, slug);
    if (!deleted) return promptNotFound(DELETE_ROUTE);
    return NextResponse.json({ success: true });
  } catch (error) {
    return storeFailure(DELETE_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting(PATCH_ROUTE, patchHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting(DELETE_ROUTE, deleteHandler, { getUserId: resolveReportingUserId });
