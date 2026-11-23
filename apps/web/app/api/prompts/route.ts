import { NextResponse } from 'next/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { CreateUserPromptBodySchema } from '@/lib/contracts/prompts';
import { filterPromptSummaries, searchTerms } from '@/lib/prompt-search';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createUserPrompt, listOwnPromptSlugs, listOwnUserPrompts, listPublicUserPrompts } from '@/lib/user-prompts';
import { currentUserPromptVersion } from '@/lib/prompt-versions';
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
    const { source } = filter.filter;
    const terms = searchTerms(filter.filter.q);
    const wantsOwn = source === undefined || source === 'own';
    const wantsCommunity = source === undefined || source === 'community';
    const own =
      !wantsOwn || caller.userId === null || caller.scopedKey ? [] : await listOwnUserPrompts(db, caller.userId, terms);
    const publicPrompts = wantsCommunity ? await listPublicUserPrompts(db, terms) : [];
    const slugOwner = wantsCommunity && !caller.scopedKey ? caller.userId : null;
    const ownSlugs =
      slugOwner === null ? [] : wantsOwn && terms.length === 0 ? own.map((row) => row.slug) : await listOwnPromptSlugs(db, slugOwner);
    const taken = new Set(ownSlugs);
    const community = publicPrompts
      .filter((row) => (caller.scopedKey || row.owner_id !== caller.userId) && !taken.has(row.slug))
      .map((row) => promptSummaryBody(row, 'community'));
    return NextResponse.json({
      success: true,
      prompts: filterPromptSummaries(
        [...own.map((row) => promptSummaryBody(row, 'own')), ...community],
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
  try {
    const db = createSupabaseServiceClient();
    const outcome = await createUserPrompt(db, owner.userId, {
      slug,
      title,
      description: description ?? '',
      prompt,
      visibility: visibility ?? 'private',
    });
    if (outcome.kind !== 'saved') return slugTaken(POST_ROUTE);
    const version = await currentUserPromptVersion(db, outcome.row.id);
    return NextResponse.json({ success: true, prompt: promptDetailBody(outcome.row, 'own', version) }, { status: 201 });
  } catch (error) {
    return storeFailure(POST_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
