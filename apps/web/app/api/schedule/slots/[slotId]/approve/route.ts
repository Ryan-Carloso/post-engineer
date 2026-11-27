import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { personaScopeOf } from '@/lib/post-detail';
import { loadAwaitingApprovalSlot, notAwaitingApproval, type SlotRouteContext } from '../owned-slot';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { assertAccessActive } from '@/lib/access';
import { createSupabaseVideoUploadStore } from '@/lib/videos/signed-upload';
import { SCHEDULED_UPLOAD_EXPIRY_MS } from '@/lib/videos/upload-expiry';
import { publishHeldSlot } from './publish-held';

const ROUTE = 'POST /api/schedule/slots/[slotId]/approve';
const APPROVAL_SLOT_GRACE_MS = 5 * 60 * 1000;

async function postHandler(request: Request, context: SlotRouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.slotApprove, auth.userId);
  if (limited) return limited;
  if (auth.isApiKey === true || auth.isOAuth === true) {
    return apiErrorResponse(403, 'API keys cannot approve posts. Sign in to approve.', { route: ROUTE });
  }
  const owned = await loadAwaitingApprovalSlot(context, auth.userId, personaScopeOf(auth), ROUTE, 'approved');
  if ('error' in owned) return owned.error;
  const { slot, publishMode } = owned;

  const serviceClient = createSupabaseServiceClient();
  const blocked = await assertAccessActive(auth.userId, { route: ROUTE });
  if (blocked) return blocked;

  const slotAtMs = Date.parse(slot.slot_at);
  if (publishMode === 'scheduled' && slotAtMs < Date.now() - APPROVAL_SLOT_GRACE_MS) {
    return apiErrorResponse(409, errorMessage(ERROR_CODES.SLOT_EXPIRED), {
      route: ROUTE,
      code: ERROR_CODES.SLOT_EXPIRED,
    });
  }

  if (publishMode === 'asap') {
    return publishHeldSlot({ request, serviceClient, userId: auth.userId, slot, route: ROUTE });
  }

  if (slot.media_kind === 'upload' && slot.media_ref !== null) {
    const uploadStore = createSupabaseVideoUploadStore();
    const extended = await uploadStore.updateUpload(slot.media_ref, 'ready', {
      expires_at: new Date(slotAtMs + SCHEDULED_UPLOAD_EXPIRY_MS).toISOString(),
    });
    if (!extended) {
      return apiErrorResponse(409, errorMessage(ERROR_CODES.VIDEO_UPLOAD_CONSUMED), {
        route: ROUTE,
        code: ERROR_CODES.VIDEO_UPLOAD_CONSUMED,
      });
    }
  }

  const { error: updateError } = await serviceClient
    .from('scheduled_posts')
    .update({ status: 'ready' })
    .eq('id', slot.id)
    .eq('user_id', auth.userId)
    .in('status', ['awaiting_approval'])
    .select('id')
    .single();
  if (updateError) {
    if ((updateError as { code?: string }).code === 'PGRST116') {
      return notAwaitingApproval(ROUTE, 'approved', slot.status);
    }
    return apiErrorResponse(500, 'Failed to approve slot.', {
      route: ROUTE,
      cause: updateError,
    });
  }
  return NextResponse.json({ success: true, status: 'ready' });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
