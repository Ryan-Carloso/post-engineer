import type { SupabaseClient } from '@supabase/supabase-js';
import { computeVideoTokens, toFiniteNumber, type FaceQuality } from '@/lib/tokens';
import { logger } from '@/lib/logger';

export async function checkAndDeductTokens(
  supabase: SupabaseClient,
  userId: string,
  generationId: string,
  faceMixPercent: number,
  faceQuality: FaceQuality,
): Promise<
  | { ok: true; cost: number }
  | { ok: false; error: string; statusCode: number; freeExhausted: boolean }
> {
  const cost = computeVideoTokens(faceMixPercent, faceQuality);

  // Lazy one-time grant: every account gets 3 free tokens on first use.
  // Best-effort — if the RPC does not exist yet (pending migration), the flow continues.
  let grantOk = false;
  let grantedFree = 0;
  try {
    const { data: grantData, error: grantError } = await supabase.rpc('grant_signup_bonus', {
      p_user_id: userId,
    });
    if (grantError) {
      logger.error('[token-check] signup bonus grant failed', grantError, { userId });
    } else if (isRecord(grantData)) {
      grantOk = grantData.granted === true || grantData.already === true;
      grantedFree = toFiniteNumber(grantData.free_balance, 0);
    }
  } catch (grantException) {
    logger.error('[token-check] signup bonus grant threw', grantException, { userId });
    grantOk = false;
  }

  const { data, error } = await supabase.rpc('spend_tokens', {
    p_user_id: userId,
    p_amount: cost,
    p_generation_id: generationId,
    p_reason: `Video generation (${faceQuality})`,
  });

  if (error) {
    logger.error('[token-check] atomic spend failed', error, { userId, generationId });
    return { ok: false, error: 'Failed to process tokens. Please try again.', statusCode: 500, freeExhausted: false };
  }

  if (!isRecord(data) || data.spent !== true) {
    const freeBalance = toFiniteNumber(isRecord(data) ? data.free_balance : grantedFree, grantedFree);
    const freeExhausted = grantOk && freeBalance <= 0;
    return {
      ok: false,
      error: freeExhausted
        ? `INSUFFICIENT_TOKENS_FREE_EXHAUSTED: Required: ${cost}. Buy more tokens to keep generating.`
        : `INSUFFICIENT_TOKENS: Required: ${cost}.`,
      statusCode: 402,
      freeExhausted,
    };
  }

  return { ok: true, cost };
}

export async function refundTokens(
  supabase: SupabaseClient,
  userId: string,
  generationId: string,
  reason = 'Generation failed; tokens refunded',
): Promise<boolean> {
  const { data, error } = await supabase.rpc('refund_generation_tokens', {
    p_user_id: userId,
    p_generation_id: generationId,
    p_reason: reason,
  });

  if (error) {
    logger.error('[token-check] refund failed', error, { userId, generationId });
    return false;
  }

  // Review round 5 (opencode): the soft-failure branch ("RPC answered,
  // refund not applied") left zero trail. Log loudly — the caller leaves
  // tokens_refunded unset so the next poll retries, and this log is the
  // only trail for that outcome.
  const refunded = isRecord(data) && data.refunded === true;
  if (!refunded) {
    logger.error('[token-check] refund not applied', null, { userId, generationId });
  }
  return refunded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
