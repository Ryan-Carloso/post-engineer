import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { isQuoteExpired } from '@/lib/experiments/quote-key';
import { batchChargeId } from '@/lib/billing/batch-discount';
import { deterministicUuid } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import type { SupabaseSessionAuth } from '@/lib/request-auth';
import { toFiniteNumber } from '@/lib/tokens';
import { scheduleAccountColumns } from '../videos/generate-and-schedule/account-columns';
import { dispatchSlot, type SlotDispatchContext, type SlotResult } from '../videos/generate-and-schedule/dispatch-slot';
import { buildIdentitySnapshot } from '../videos/generate-and-schedule/identity-snapshot';
import { violatedConstraint, SCHEDULE_PK_CONSTRAINT } from '../videos/generate-and-schedule/constraint-violations';
import { persistVoiceSwap } from '../videos/generate-and-schedule/prepare-persona';
import { resolvePriorSpend } from '../videos/generate-and-schedule/prior-spend';
import { refundRollbackSpend } from '../videos/generate-and-schedule/rollback-refund';
import { deleteInsertedSlots } from '../videos/generate-and-schedule/rollback-slots';
import { buildSlotRows } from '../videos/generate-and-schedule/slot-rows';
import { experimentError, internalError, planExperiment, quoteKeyOf, type ExperimentPlan, type PlannedVideo } from './create-plan';
import { fetchReplayRows, replayResponse, resolveExistingSchedule } from './create-replay';

const SCHEDULE_NAMESPACE = 'experiments-create/v1';

export function experimentScheduleId(userId: string, quoteKey: string): string {
  return deterministicUuid(SCHEDULE_NAMESPACE, `${userId}:${quoteKey}`);
}

async function replayWinner(supabase: SupabaseClient, plan: ExperimentPlan, scheduleId: string): Promise<NextResponse> {
  const rows = await fetchReplayRows(supabase, plan.userId, scheduleId);
  if (rows === null || rows.length === 0) return internalError();
  return replayResponse(scheduleId, rows, plan.warnings);
}

async function spendTotal(
  supabase: SupabaseClient,
  plan: ExperimentPlan,
  generationId: string,
): Promise<NextResponse | null> {
  try {
    await supabase.rpc('grant_signup_bonus', { p_user_id: plan.userId });
  } catch (error) {
    logger.warn('[experiments-create] signup bonus grant failed', { userId: plan.userId, error: String(error) });
  }
  const { data, error } = await supabase.rpc('spend_tokens', {
    p_user_id: plan.userId,
    p_amount: plan.totalTokens,
    p_generation_id: generationId,
    p_reason: `Experiment create (${plan.videos.length} videos)`,
  });
  if (error) {
    logger.error('[experiments-create] atomic spend failed', error, { userId: plan.userId, generationId });
    return internalError();
  }
  const record = (data ?? {}) as { spent?: boolean; balance?: unknown };
  if (record.spent === true) return null;
  const have = toFiniteNumber(record.balance, 0);
  return experimentError(
    402,
    ERROR_CODES.INSUFFICIENT_TOKENS,
    formatErrorMessage(ERROR_CODES.INSUFFICIENT_TOKENS, { need: plan.totalTokens, have }),
    undefined,
    { have, need: plan.totalTokens },
  );
}

function refundWhole(supabase: SupabaseClient, plan: ExperimentPlan, generationId: string, reason: string): Promise<boolean> {
  return refundRollbackSpend(supabase, { userId: plan.userId, generationId, amount: plan.totalTokens, reason });
}

function scheduleInsert(plan: ExperimentPlan, scheduleId: string) {
  return {
    id: scheduleId,
    user_id: plan.userId,
    persona_id: plan.personaId,
    providers: plan.providers,
    ...scheduleAccountColumns(plan.accountIds),
    pinterest_board_id: null,
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: plan.times.length,
    times: plan.times,
    timezone: plan.timezone,
    scheduled_at: null,
    active: true,
    publish_mode: 'scheduled',
    ...buildIdentitySnapshot(plan.prep, plan.options.audioUrl, plan.effectiveCta),
  };
}

function slotRows(plan: ExperimentPlan, scheduleId: string) {
  return plan.videos.flatMap((video) =>
    buildSlotRows({
      slots: [video.slot],
      title: video.title,
      description: video.description,
      scheduleId,
      userId: plan.userId,
      videoType: plan.options.videoType,
      musicMood: plan.options.musicMood,
      chargedTokens: plan.perVideoCost,
      segments: video.segments,
      lipsyncPhotos: plan.options.lipsyncPhotos,
      hookTitle: plan.options.hookTitle,
      promptVersionId: video.versionId,
    }),
  );
}

interface InsertedSlot {
  id: string;
  slot_at: string;
}

function pairInsertedSlots(plan: ExperimentPlan, inserted: InsertedSlot[] | null): Array<{ row: InsertedSlot; video: PlannedVideo }> | null {
  if (inserted === null || inserted.length !== plan.videos.length) return null;
  const byTime = new Map(plan.videos.map((video) => [Date.parse(video.slot.slotAtISO), video]));
  const pairs: Array<{ row: InsertedSlot; video: PlannedVideo }> = [];
  for (const row of inserted) {
    const video = byTime.get(Date.parse(row.slot_at));
    if (video === undefined) return null;
    pairs.push({ row, video });
  }
  return pairs.sort((left, right) => Date.parse(left.row.slot_at) - Date.parse(right.row.slot_at));
}

export async function confirmExperiment(
  supabase: SupabaseClient,
  auth: SupabaseSessionAuth,
  body: CreateExperimentBody,
  now: Date,
): Promise<NextResponse> {
  const { quoteKey, expiresAt } = body;
  if (quoteKey === undefined || expiresAt === undefined) {
    return experimentError(400, ERROR_CODES.VALIDATION_FAILED, 'quoteKey and expiresAt are required to confirm.', 'quoteKey');
  }
  const userId = auth.userId;
  const scheduleId = experimentScheduleId(userId, quoteKey);
  const generationId = batchChargeId(scheduleId);

  const existing = await resolveExistingSchedule(supabase, userId, scheduleId);
  if (existing instanceof NextResponse) return existing;
  if (existing.replay !== null) return existing.replay;
  if (isQuoteExpired(expiresAt, now)) {
    return experimentError(409, ERROR_CODES.QUOTE_EXPIRED, formatErrorMessage(ERROR_CODES.QUOTE_EXPIRED));
  }
  const plan = await planExperiment(supabase, auth, body);
  if (plan instanceof NextResponse) return plan;
  if (quoteKeyOf(plan, expiresAt) !== quoteKey) {
    return experimentError(409, ERROR_CODES.QUOTE_CHANGED, formatErrorMessage(ERROR_CODES.QUOTE_CHANGED));
  }

  const priorSpend = await resolvePriorSpend(supabase, { userId, scheduleId, generationId, scheduleWasLive: existing.live });
  if (!('alreadySpent' in priorSpend)) return priorSpend;
  const { alreadySpent } = priorSpend;
  if (!alreadySpent) {
    const spendFailure = await spendTotal(supabase, plan, generationId);
    if (spendFailure !== null) return spendFailure;
  }

  if (plan.prep.voiceFallback !== undefined && plan.personaId !== null) {
    await persistVoiceSwap(supabase, userId, plan.personaId, plan.prep.voiceFallback);
  }

  const { error: scheduleError } = await supabase.from('schedules').insert(scheduleInsert(plan, scheduleId));
  if (scheduleError) {
    if (violatedConstraint(scheduleError) === SCHEDULE_PK_CONSTRAINT) {
      if (!alreadySpent) await refundWhole(supabase, plan, generationId, 'Experiment create: duplicate confirm; refunded redundant spend');
      return replayWinner(supabase, plan, scheduleId);
    }
    logger.error('[experiments-create] schedule insert failed after spend; refunding', scheduleError, { scheduleId, userId });
    await refundWhole(supabase, plan, generationId, 'Experiment create: schedule insert failed; tokens refunded');
    return internalError();
  }

  const { data: inserted, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(slotRows(plan, scheduleId))
    .select('id, slot_at');
  const pairs = slotsError ? null : pairInsertedSlots(plan, inserted as InsertedSlot[] | null);
  if (pairs === null) {
    logger.error('[experiments-create] slot insert failed; rolling back schedule', slotsError, { scheduleId, userId });
    await deleteInsertedSlots(supabase, userId, (inserted as InsertedSlot[] | null) ?? null);
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    await refundWhole(supabase, plan, generationId, 'Experiment create: slot insert failed; tokens refunded');
    return internalError();
  }

  const context: SlotDispatchContext = {
    supabase,
    userId,
    personaId: plan.personaId,
    prep: plan.prep,
    validatedOptions: plan.options,
    effectiveCta: plan.effectiveCta,
    requestedImageId: plan.personaId !== null ? plan.options.imageId?.trim() || null : null,
    generationId,
    scheduleId,
    perVideoCost: plan.perVideoCost,
    mode: 'scheduled',
    recentIds: [],
  };
  const results: Array<SlotResult & { versionId: string }> = [];
  for (const { row, video } of pairs) {
    const result = await dispatchSlot(context, {
      id: row.id,
      slotAt: row.slot_at,
      title: video.title,
      description: video.description,
      script: video.script,
      segments: video.segments,
    });
    results.push({ ...result, versionId: video.versionId });
  }

  const accepted = results.filter((result) => result.status !== 'failed').length;
  const refundedTokens = results.reduce((sum, result) => sum + (result.status === 'failed' && result.tokensRefunded === true ? plan.perVideoCost : 0), 0);
  const envelope = {
    stage: 'confirmed',
    scheduleId,
    replayed: false,
    chargedTokens: plan.totalTokens - refundedTokens,
    slots: results,
    warnings: plan.warnings,
  };
  if (accepted === 0) {
    const engineOutage = results.every((result) =>
      ['engine_rejected', 'engine_unavailable', 'no_task_id'].includes(result.errorCode ?? ''),
    );
    const code = engineOutage ? ERROR_CODES.ENGINE_UNAVAILABLE : ERROR_CODES.INTERNAL_ERROR;
    return NextResponse.json({ success: false, error: formatErrorMessage(code), code, ...envelope }, { status: 502 });
  }
  return NextResponse.json({ success: true, ...envelope });
}
