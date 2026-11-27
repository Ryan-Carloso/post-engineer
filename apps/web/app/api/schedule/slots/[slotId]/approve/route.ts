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
import { CONTACT_WHATSAPP_URL } from '@/lib/contact';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { readTrialEndsAt } from '@/lib/trial';
import { computeTrialStatus } from '@/lib/trial-status';
import { createSupabaseVideoUploadStore } from '@/lib/videos/signed-upload';
import { SCHEDULED_UPLOAD_EXPIRY_MS } from '@/lib/videos/upload-expiry';
import { publishHeldSlot } from './publish-held';

const ROUTE = 'POST /api/schedule/slots/[slotId]/approve';
const APPROVAL_SLOT_GRACE_MS = 5 * 60 * 1000;

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
  const { slot, publishMode } = owned;

  if (slot.status !== 'awaiting_approval') {
    return apiErrorResponse(409, 'Only an awaiting-approval slot can be approved.', {
      route: ROUTE,
      code: ERROR_CODES.SLOT_NOT_AWAITING_APPROVAL,
      metadata: { status: slot.status },
    });
  }

  const serviceClient = createSupabaseServiceClient();
  let trialEndsAt: string;
  try {
    trialEndsAt = await readTrialEndsAt(serviceClient, auth.userId);
  } catch (error) {
    logger.error('[api/schedule/slots] trial lookup failed', error, { userId: auth.userId });
    return apiErrorResponse(500, errorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
      cause: error,
    });
  }
  if (!computeTrialStatus(trialEndsAt, new Date()).active) {
    return apiErrorResponse(403, errorMessage(ERROR_CODES.TRIAL_EXPIRED), {
      route: ROUTE,
      code: ERROR_CODES.TRIAL_EXPIRED,
      extra: { contactUrl: CONTACT_WHATSAPP_URL, trialEndedAt: trialEndsAt },
    });
  }

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
      return apiErrorResponse(409, 'Only an awaiting-approval slot can be approved.', {
        route: ROUTE,
        code: ERROR_CODES.SLOT_NOT_AWAITING_APPROVAL,
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
