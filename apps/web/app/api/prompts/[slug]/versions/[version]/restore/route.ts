import { NextResponse } from 'next/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { RestorePromptVersionBodySchema } from '@/lib/contracts/prompts';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { currentUserPromptVersion } from '@/lib/prompt-versions';
import { restoreUserPromptVersion } from '@/lib/prompt-version-history';
import { promptDetailBody, promptNotFound, readJsonBody, resolvePromptOwnerSlug, storeFailure } from '@/lib/user-prompts-http';
import { promptVersionConflict, promptVersionNotFound, readVersionSegment } from '@/lib/prompt-versions-http';

type RouteContext = { params: Promise<{ slug: string; version: string }> };

const POST_ROUTE = 'POST /api/prompts/[slug]/versions/[version]/restore';

async function postHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const target = await resolvePromptOwnerSlug(request, context.params, POST_ROUTE, RATE_LIMITS.promptsWrite);
  if (target instanceof NextResponse) return target;
  const version = readVersionSegment((await context.params).version, POST_ROUTE);
  if (version instanceof NextResponse) return version;
  const parsed = await readJsonBody(request, RestorePromptVersionBodySchema, POST_ROUTE);
  if (!parsed.ok) return parsed.response;
  try {
    const db = createSupabaseServiceClient();
    const outcome = await restoreUserPromptVersion(db, target.userId, target.slug, version, parsed.body.expectedCurrentVersion);
    if (outcome.kind === 'not_found') return promptNotFound(POST_ROUTE);
    if (outcome.kind === 'version_not_found') return promptVersionNotFound(POST_ROUTE);
    if (outcome.kind === 'conflict') return promptVersionConflict(POST_ROUTE);
    const current = await currentUserPromptVersion(db, outcome.row.id);
    return NextResponse.json({
      success: true,
      restored: outcome.kind === 'restored',
      prompt: promptDetailBody(outcome.row, 'own', current),
    });
  } catch (error) {
    return storeFailure(POST_ROUTE, error);
  }
}

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
