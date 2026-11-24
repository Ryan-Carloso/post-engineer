import { NextResponse } from 'next/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { findOwnUserPrompt } from '@/lib/user-prompts';
import { listUserPromptVersions } from '@/lib/prompt-version-history';
import { promptNotFound, resolvePromptOwnerSlug, storeFailure } from '@/lib/user-prompts-http';
import { readVersionsQuery } from '@/lib/prompt-versions-http';

type RouteContext = { params: Promise<{ slug: string }> };

const GET_ROUTE = 'GET /api/prompts/[slug]/versions';

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const target = await resolvePromptOwnerSlug(request, context.params, GET_ROUTE, RATE_LIMITS.promptsRead);
  if (target instanceof NextResponse) return target;
  const query = readVersionsQuery(request, GET_ROUTE);
  if (query instanceof NextResponse) return query;
  try {
    const db = createSupabaseServiceClient();
    const prompt = await findOwnUserPrompt(db, target.userId, target.slug);
    if (prompt === null) return promptNotFound(GET_ROUTE);
    const page = await listUserPromptVersions(db, prompt.id, query);
    return NextResponse.json({ success: true, ...page });
  } catch (error) {
    return storeFailure(GET_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
