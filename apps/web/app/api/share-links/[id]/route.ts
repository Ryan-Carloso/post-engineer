import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { UUID } from '@/lib/metrics/metrics-query';

const ROUTE = 'DELETE /api/share-links/[id]';

async function deleteHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.shareLinkManage);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  if (isScopedApiKey(auth)) {
    return apiErrorResponse(403, 'A persona-scoped API key cannot manage share links.', { route: ROUTE });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) return apiErrorResponse(404, 'Share link not found.', { route: ROUTE });

  const supabase = createSupabaseServiceClient();
  const { data: revoked, error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .select('id');
  if (error) {
    return apiErrorResponse(500, 'Failed to revoke the share link.', { route: ROUTE, cause: error });
  }
  if ((revoked ?? []).length > 0) return NextResponse.json({ success: true, alreadyRevoked: false });

  const { data: existing, error: existingError } = await supabase
    .from('share_links')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (existingError) {
    return apiErrorResponse(500, 'Failed to revoke the share link.', { route: ROUTE, cause: existingError });
  }
  if (existing === null) return apiErrorResponse(404, 'Share link not found.', { route: ROUTE });
  return NextResponse.json({ success: true, alreadyRevoked: true });
}

export const DELETE = withApiErrorReporting('DELETE /api/share-links/[id]', deleteHandler, { getUserId: resolveReportingUserId });
