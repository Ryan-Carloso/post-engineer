import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { personaScopeOf } from '@/lib/post-detail';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { loadOwnedSlot } from '../route';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'POST /api/schedule/slots/[slotId]/approve';

async function postHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.slotApprove, auth.userId);
  if (limited) return limited;
  if (auth.isApiKey === true || auth.isOAuth === true) {
    return apiErrorResponse(403, 'API keys cannot approve posts. Sign in to approve.', { route: ROUTE });
  }
  const supabase = await createSupabaseServerClient();

  const { slotId } = await context.params;

  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: ROUTE });
  }

  const owned = await loadOwnedSlot(supabase, resolvedSlotId, auth.userId, personaScopeOf(auth));
  if ('error' in owned) return owned.error;
  const slot = owned.slot;

  if (slot.status !== 'awaiting_approval') {
    return apiErrorResponse(409, 'Only an awaiting-approval slot can be approved.', {
      route: ROUTE,
      metadata: { status: slot.status },
    });
  }

  const { error: updateError } = await createSupabaseServiceClient()
    .from('scheduled_posts')
    .update({ status: 'ready' })
    .eq('id', slot.id)
    .eq('user_id', auth.userId)
    .in('status', ['awaiting_approval'])
    .select('id')
    .single();
  if (updateError) {
    if ((updateError as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(409, 'Only an awaiting-approval slot can be approved.', {
        route: ROUTE,
        metadata: { status: slot.status },
      });
    }
    return apiErrorResponse(500, 'Failed to approve slot.', {
      route: ROUTE,
      cause: updateError,
    });
  }
  return NextResponse.json({ success: true, status: 'ready' });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
