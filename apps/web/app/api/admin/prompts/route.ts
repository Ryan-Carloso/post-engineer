import { NextResponse } from 'next/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { listPendingUserPrompts } from '@/lib/user-prompts';
import { resolveReviewer, storeFailure } from '@/lib/user-prompts-http';

const ROUTE = 'GET /api/admin/prompts';

async function getHandler(request: Request): Promise<NextResponse> {
  const reviewer = await resolveReviewer(request, ROUTE, RATE_LIMITS.promptsReview);
  if (reviewer instanceof NextResponse) return reviewer;
  try {
    const { rows, truncated } = await listPendingUserPrompts(createSupabaseServiceClient());
    return NextResponse.json({
      success: true,
      truncated,
      prompts: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        prompt: row.body,
        contentHash: row.content_hash,
        authorId: row.owner_id,
        requestedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return storeFailure(ROUTE, error);
  }
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
