import { NextResponse } from 'next/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { findOwnUserPrompt } from '@/lib/user-prompts';
import { getUserPromptVersion } from '@/lib/prompt-version-history';
import { promptNotFound, resolvePromptOwnerSlug, storeFailure } from '@/lib/user-prompts-http';
import { promptVersionNotFound, readVersionSegment } from '@/lib/prompt-versions-http';

type RouteContext = { params: Promise<{ slug: string; version: string }> };

const GET_ROUTE = 'GET /api/prompts/[slug]/versions/[version]';

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const target = await resolvePromptOwnerSlug(request, context.params, GET_ROUTE, RATE_LIMITS.promptsRead);
  if (target instanceof NextResponse) return target;
  const version = readVersionSegment((await context.params).version, GET_ROUTE);
  if (version instanceof NextResponse) return version;
  try {
    const db = createSupabaseServiceClient();
    const prompt = await findOwnUserPrompt(db, target.userId, target.slug);
    if (prompt === null) return promptNotFound(GET_ROUTE);
    const detail = await getUserPromptVersion(db, prompt.id, version);
    if (detail === null) return promptVersionNotFound(GET_ROUTE);
    return NextResponse.json({ success: true, version: detail });
  } catch (error) {
    return storeFailure(GET_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
