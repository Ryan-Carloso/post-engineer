import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { CreateUserPromptBodySchema } from '@/lib/contracts/prompts';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { filterPromptSummaries } from '@/lib/prompt-search';
import { isOfficialPromptSlug, listHubPrompts } from '@/lib/recipes/hub-prompts';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createUserPrompt, listOwnUserPrompts, listPublicUserPrompts } from '@/lib/user-prompts';
import {
  promptDetailBody,
  promptSummaryBody,
  readJsonBody,
  readListFilter,
  requireOwner,
  resolvePromptCaller,
  slugTaken,
  storeFailure,
} from '@/lib/user-prompts-http';

const GET_ROUTE = 'GET /api/prompts';
const POST_ROUTE = 'POST /api/prompts';

async function getHandler(request: Request): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, GET_ROUTE, RATE_LIMITS.promptsRead, { allowAnonymous: true });
  if (caller instanceof NextResponse) return caller;
  const filter = readListFilter(request, GET_ROUTE);
  if (!filter.ok) return filter.response;
  try {
    const db = createSupabaseServiceClient();
    const own = caller.userId === null || caller.scopedKey ? [] : await listOwnUserPrompts(db, caller.userId);
    const publicPrompts = await listPublicUserPrompts(db);
    const official = listHubPrompts().map((entry) => ({ ...entry, source: 'official' as const, visibility: 'public' as const }));
    const taken = new Set([...official, ...own].map((entry) => entry.slug));
    const community = publicPrompts
      .filter((row) => (caller.scopedKey || row.owner_id !== caller.userId) && !taken.has(row.slug))
      .map((row) => promptSummaryBody(row, 'community'));
    return NextResponse.json({
      success: true,
      prompts: filterPromptSummaries(
        [...official, ...own.map((row) => promptSummaryBody(row, 'own')), ...community],
        filter.filter,
      ),
    });
  } catch (error) {
    return storeFailure(GET_ROUTE, error);
  }
}

async function postHandler(request: Request): Promise<NextResponse> {
  const caller = await resolvePromptCaller(request, POST_ROUTE, RATE_LIMITS.promptsWrite, { allowAnonymous: false });
  if (caller instanceof NextResponse) return caller;
  const owner = requireOwner(caller, POST_ROUTE);
  if (owner instanceof NextResponse) return owner;
  const parsed = await readJsonBody(request, CreateUserPromptBodySchema, POST_ROUTE);
  if (!parsed.ok) return parsed.response;
  const { slug, title, description, prompt, visibility } = parsed.body;
  if (isOfficialPromptSlug(slug)) {
    return apiErrorResponse(409, errorMessage(ERROR_CODES.PROMPT_SLUG_RESERVED), {
      route: POST_ROUTE,
      code: ERROR_CODES.PROMPT_SLUG_RESERVED,
      field: 'slug',
    });
  }
  try {
    const outcome = await createUserPrompt(createSupabaseServiceClient(), owner.userId, {
      slug,
      title,
      description: description ?? '',
      prompt,
      visibility: visibility ?? 'private',
    });
    if (outcome.kind !== 'saved') return slugTaken(POST_ROUTE);
    return NextResponse.json({ success: true, prompt: promptDetailBody(outcome.row, 'own') }, { status: 201 });
  } catch (error) {
    return storeFailure(POST_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
