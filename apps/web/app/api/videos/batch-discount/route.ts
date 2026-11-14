//---------------
// POST /api/videos/batch-discount — the "6 for 5" batch discount (issue #487).
//
// The MCP tool generate_video creates each video of a batch
// with generate-and-schedule (charged at list price, dispatched to the
// engine at once, so they render back to back in one warm Modal container)
// and then calls this route with the batch key and the created schedule
// ids. The route groups those videos into one batch and credits back the
// cheapest face video of every BATCH_FREE_EVERY (lib/billing/batch-discount).
//
// Rules the server enforces (never trusted from the caller):
//   - every schedule belongs to the caller (404 otherwise) and, for a
//     persona-scoped API key, to one of its personas (403);
//   - a video already in another batch cannot join this one (409);
//   - at most MAX_BATCH_VIDEOS videos per batch (400);
//   - every video was created within BATCH_WINDOW_MS of the first (409):
//     a batch is videos made together, not posts gathered over days.
// Idempotent: the batch id is derived from (user, batchKey), so calling it
// again with the same key (a retry that adds the rest of the batch)
// only adds the missing free videos; it never credits a video twice.
//---------------

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES } from '@/lib/error-codes';
import { trackApiEvent } from '@/lib/analytics';
import { deterministicUuid } from '@/lib/idempotency';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  BATCH_WINDOW_MS,
  batchFreeCount,
  MAX_BATCH_VIDEOS,
  withinBatchWindow,
  type BatchSlot,
} from '@/lib/billing/batch-discount';
import { applyDiscount, claimSlots, readSlotsByBatch, readSlotsBySchedules } from './apply';

const ROUTE = 'POST /api/videos/batch-discount';

/** Namespace for the deterministic batch id; never reuse it for another id. */
const BATCH_NAMESPACE = 'batch-discount/v1';

const BodySchema = z
  .object({
    batchKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, 'batchKey may only contain letters, digits, "-" and "_".'),
    scheduleIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_VIDEOS),
  })
  .strict();

function fail(status: number, error: string, code: string, cause?: unknown): NextResponse {
  return apiErrorResponse(status, error, { code, route: ROUTE, ...(cause === undefined ? {} : { cause }) });
}

async function postHandler(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Invalid JSON payload.', ERROR_CODES.VALIDATION_FAILED);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiErrorResponse(400, issue?.message ?? 'Request validation failed.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: issue?.path.join('.') ?? undefined,
      route: ROUTE,
    });
  }
  const { batchKey, scheduleIds } = parsed.data;
  if (new Set(scheduleIds).size !== scheduleIds.length) {
    return fail(400, 'scheduleIds must not repeat a schedule.', ERROR_CODES.VALIDATION_FAILED);
  }

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const userId = auth.userId;
  const limited = await applyRateLimit(request, RATE_LIMITS.batchDiscount, userId);
  if (limited) return limited;

  // Service role for every caller: refund_batch_tokens and the slot updates
  // run server-side only. Ownership is re-checked by user_id on each query.
  const supabase = createSupabaseServiceClient();

  const { data: schedules, error: schedulesError } = await supabase
    .from('schedules')
    .select('id, persona_id')
    .eq('user_id', userId)
    .in('id', scheduleIds);
  if (schedulesError) return fail(500, 'Failed to read the batch schedules.', ERROR_CODES.INTERNAL_ERROR, schedulesError);
  if ((schedules ?? []).length !== scheduleIds.length) {
    return fail(404, 'One or more schedules do not exist.', 'SCHEDULE_NOT_FOUND');
  }
  if (auth.isApiKey === true && Array.isArray(auth.personaIds)) {
    const allowed = new Set(auth.personaIds);
    const outOfScope = (schedules ?? []).some((row) => {
      const personaId = (row as { persona_id?: unknown }).persona_id;
      return typeof personaId === 'string' && !allowed.has(personaId);
    });
    if (outOfScope) return fail(403, 'This API key cannot access one of the schedules.', ERROR_CODES.PERSONA_SCOPE_DENIED);
  }

  const batchId = deterministicUuid(BATCH_NAMESPACE, `${userId}:${batchKey}`);
  const requested = await readSlotsBySchedules(supabase, userId, scheduleIds);
  if (!requested.ok) return fail(500, 'Failed to read the batch videos.', ERROR_CODES.INTERNAL_ERROR, requested.error);
  const withSlot = new Set(requested.slots.map((slot) => slot.scheduleId));
  if (scheduleIds.some((id) => !withSlot.has(id))) {
    return fail(404, 'One or more schedules have no video.', 'SCHEDULE_NOT_FOUND');
  }
  if (requested.batchIds.some((id) => id !== null && id !== batchId)) {
    return fail(409, 'A video is already part of another batch.', 'BATCH_CONFLICT');
  }

  const members = await readSlotsByBatch(supabase, userId, batchId);
  if (!members.ok) return fail(500, 'Failed to read the batch videos.', ERROR_CODES.INTERNAL_ERROR, members.error);
  const union = new Map<string, BatchSlot>();
  for (const slot of [...members.slots, ...requested.slots]) union.set(slot.id, slot);
  const all = [...union.values()];
  if (all.length > MAX_BATCH_VIDEOS) {
    return fail(400, `A batch holds at most ${MAX_BATCH_VIDEOS} videos.`, 'BATCH_TOO_LARGE');
  }
  if (!withinBatchWindow(all)) {
    return fail(
      409,
      `Every video of a batch must be created within ${BATCH_WINDOW_MS / 60_000} minutes of the first.`,
      'BATCH_WINDOW_EXCEEDED',
    );
  }

  const toClaim = requested.slots.filter((slot, index) => requested.batchIds[index] === null).map((slot) => slot.id);
  const claimed = await claimSlots(supabase, userId, batchId, toClaim);
  if (!claimed.ok) return fail(500, 'Failed to group the batch videos.', ERROR_CODES.INTERNAL_ERROR, claimed.error);
  // Re-read after the claim: the discount is planned on the rows that
  // really carry this batch id, never on the pre-claim snapshot.
  const batch = await readSlotsByBatch(supabase, userId, batchId);
  if (!batch.ok) return fail(500, 'Failed to read the batch videos.', ERROR_CODES.INTERNAL_ERROR, batch.error);
  const inBatch = new Set(batch.slots.map((slot) => slot.id));
  if (requested.slots.some((slot) => !inBatch.has(slot.id))) {
    return fail(409, 'A video is already part of another batch.', 'BATCH_CONFLICT');
  }
  if (batch.slots.length > MAX_BATCH_VIDEOS) {
    return fail(409, `A batch holds at most ${MAX_BATCH_VIDEOS} videos.`, 'BATCH_TOO_LARGE');
  }

  const { newlyFree, warnings } = await applyDiscount(supabase, userId, batch.slots);
  const newlyFreeIds = new Set(newlyFree.map((slot) => slot.id));
  const final = batch.slots.map((slot) =>
    newlyFreeIds.has(slot.id) ? { ...slot, chargedTokens: 0, discountTokens: slot.chargedTokens } : slot,
  );
  const free = final.filter((slot) => slot.discountTokens > 0);
  const faceVideos = final.filter((slot) => !slot.faceless).length;
  const discountTokens = free.reduce((sum, slot) => sum + slot.discountTokens, 0);
  if (newlyFree.length > 0) {
    trackApiEvent('batch_discount_applied', {
      userId,
      batchId,
      batchSize: final.length,
      faceVideos,
      freeVideos: free.length,
      newlyFreeVideos: newlyFree.length,
      discountTokens,
    });
  }
  return NextResponse.json({
    success: true,
    batchId,
    videos: final.length,
    faceVideos,
    earnedFreeVideos: batchFreeCount(final),
    freeVideos: free.map((slot) => ({ scheduleId: slot.scheduleId, slotId: slot.id, discountTokens: slot.discountTokens })),
    discountTokens,
    chargedTokens: final.reduce((sum, slot) => sum + slot.chargedTokens, 0),
    warnings: [...new Set(warnings)],
  });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
