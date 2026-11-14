//---------------
// Shared web refund helper — the single place request-path refunds move
// tokens and say so.
//
// The dispatch-failure catch in generate-and-schedule and the DELETE
// /api/schedule cancel refunds both call refund_batch_tokens, but neither
// emitted anything: only the engine emits refund_issued, so a user who
// cancelled a ready video (or whose dispatch failed) had no trace in
// PostHog that their tokens came back. Every request-path refund funnels
// through here so the tokens move and the audit event fires together.
//
// Telemetry rules (same as the engine's track_refund_issued in
// apps/engine/app/services/fill_schedule/support.py and the web
// reconciler's trackRefundIssued in ./reconcile.ts):
// - Fire refund_issued ONLY on a landed refund (refunded === true).
//   The RPC is idempotent, so already_refunded means a previous call
//   already settled this slot — firing again would double-count it.
// - The token count travels as `amount`, never a `token*` key: the
//   scrubber redacts every key containing "token", which would erase
//   the audit value of the event.
// - These events intentionally bypass scrubSecrets (the call goes to
//   captureAs directly). That is safe here because every property is
//   constructed from typed store outputs (uuids, counts, fixed reason
//   literals): no request input, no secrets, no credential-shaped
//   values can reach these calls.
// - Telemetry must never break the request path: emitRefundIssued never
//   throws, and refundSlotTokens reports RPC failures in its result
//   instead of throwing, so the caller can log them and keep going.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPostHogServer } from '@/lib/posthog-server';
import { batchChargeId, batchSlotRefundKey } from './batch-discount';

/** Request paths that refund a prepaid slot. */
export type RefundEventKind = 'dispatch_failed' | 'schedule_cancelled';

export interface RefundIssuedProperties {
  kind: RefundEventKind;
  amount: number;
  reason: string;
  batchGenerationId: string;
  scheduleId: string;
  slotId: string;
  engineTaskId: string | null;
}

/**
 * Emit refund_issued for a landed refund, mirroring the engine's
 * track_refund_issued property shape (kind, amount, reason,
 * batch_generation_id, slot_id, engine_task_id) plus schedule_id so the
 * cancel can be found without deriving it from the batch id. The user id
 * travels both as the distinct_id (captureAs) and as user_id, matching
 * the engine event. Callers must invoke this ONLY after the refund RPC
 * reports refunded === true — never optimistically, never for an
 * already-refunded slot.
 */
export function emitRefundIssued(userId: string, props: RefundIssuedProperties): void {
  try {
    getPostHogServer()?.captureAs(userId, 'refund_issued', {
      kind: props.kind,
      user_id: userId,
      amount: props.amount,
      reason: props.reason,
      batch_generation_id: props.batchGenerationId,
      schedule_id: props.scheduleId,
      slot_id: props.slotId,
      engine_task_id: props.engineTaskId,
    });
  } catch {
    // Telemetry must never break the request path.
  }
}

export interface RefundSlotTokensInput {
  supabase: SupabaseClient;
  userId: string;
  scheduleId: string;
  slotId: string;
  amount: number;
  reason: string;
  kind: RefundEventKind;
  engineTaskId?: string | null;
}

export interface RefundSlotTokensResult {
  refunded: boolean;
  alreadyRefunded: boolean;
  error?: unknown;
}

/**
 * Refund one prepaid slot via the idempotent refund_batch_tokens RPC and
 * emit refund_issued when the tokens actually moved. The refund key is
 * derived from the schedule and slot ids (batchSlotRefundKey), so it
 * matches the key the cancel path uses — a slot refunded on one path is
 * never credited twice on the other. Returns the RPC outcome without
 * throwing: `refunded` means the tokens moved on this call,
 * `alreadyRefunded` means a previous call already settled the slot (the
 * tokens are back either way), and `error` carries the RPC failure for
 * the caller to log.
 */
export async function refundSlotTokens(input: RefundSlotTokensInput): Promise<RefundSlotTokensResult> {
  const batchGenerationId = batchChargeId(input.scheduleId);
  let data: unknown = null;
  let error: unknown = null;
  try {
    const res = await input.supabase.rpc('refund_batch_tokens', {
      p_user_id: input.userId,
      p_batch_generation_id: batchGenerationId,
      p_refund_key: batchSlotRefundKey(input.scheduleId, input.slotId),
      p_amount: input.amount,
      p_reason: input.reason,
      p_engine_task_id: input.engineTaskId ?? null,
    });
    data = res.data;
    error = res.error;
  } catch (thrown) {
    return { refunded: false, alreadyRefunded: false, error: thrown };
  }
  if (error) return { refunded: false, alreadyRefunded: false, error };
  const payload = (data ?? {}) as { refunded?: unknown; already_refunded?: unknown };
  const refunded = payload.refunded === true;
  const alreadyRefunded = payload.already_refunded === true;
  if (refunded) {
    emitRefundIssued(input.userId, {
      kind: input.kind,
      amount: input.amount,
      reason: input.reason,
      batchGenerationId,
      scheduleId: input.scheduleId,
      slotId: input.slotId,
      engineTaskId: input.engineTaskId ?? null,
    });
  }
  return { refunded, alreadyRefunded };
}
