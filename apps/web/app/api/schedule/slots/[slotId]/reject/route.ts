import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { personaScopeOf } from '@/lib/post-detail';
import { loadAwaitingApprovalSlot, notAwaitingApproval, type SlotRouteContext } from '../owned-slot';
import { removeCancelledMediaImages } from '../../../cancel-media-cleanup';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'POST /api/schedule/slots/[slotId]/reject';

async function postHandler(request: Request, context: SlotRouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.slotApprove, auth.userId);
  if (limited) return limited;
  if (auth.isApiKey === true || auth.isOAuth === true) {
    return apiErrorResponse(403, 'API keys cannot reject posts. Sign in to reject.', { route: ROUTE });
  }
  const owned = await loadAwaitingApprovalSlot(context, auth.userId, personaScopeOf(auth), ROUTE, 'rejected');
  if ('error' in owned) return owned.error;
  const slot = owned.slot;

  const { error: updateError } = await createSupabaseServiceClient()
    .from('scheduled_posts')
    .update({ status: 'cancelled', media_ref: null, media_kind: null, media_content_type: null })
    .eq('id', slot.id)
    .eq('user_id', auth.userId)
    .in('status', ['awaiting_approval'])
    .select('id')
    .single();
  if (updateError) {
    if ((updateError as { code?: string }).code === 'PGRST116') {
      return notAwaitingApproval(ROUTE, 'rejected', slot.status);
    }
    return apiErrorResponse(500, 'Failed to reject slot.', {
      route: ROUTE,
      cause: updateError,
    });
  }
  await removeCancelledMediaImages(createSupabaseServiceClient(), [
    { id: slot.id, status: slot.status, mediaKind: slot.media_kind, mediaRef: slot.media_ref },
  ], auth.userId);
  return NextResponse.json({ success: true, status: 'cancelled' });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
