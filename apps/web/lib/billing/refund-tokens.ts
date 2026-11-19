import type { SupabaseClient } from '@supabase/supabase-js';
import { getPostHogServer } from '@/lib/posthog-server';
import { redactCredentialFragments } from '@/lib/scrub';
import { batchChargeId, batchSlotRefundKey } from './batch-discount';

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

export function emitRefundIssued(userId: string, props: RefundIssuedProperties): void {
  try {
    getPostHogServer()?.captureAs(userId, 'refund_issued', {
      kind: props.kind,
      user_id: userId,
      amount: props.amount,
      reason: props.reason,
      batch_generation_id: redactCredentialFragments(props.batchGenerationId),
      schedule_id: redactCredentialFragments(props.scheduleId),
      slot_id: redactCredentialFragments(props.slotId),
      engine_task_id:
        props.engineTaskId === null ? null : redactCredentialFragments(props.engineTaskId),
    });
  } catch {
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
