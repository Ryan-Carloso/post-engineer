import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleAccountColumns } from '@/app/api/videos/generate-and-schedule/account-columns';
import { refundRollbackSpend } from '@/app/api/videos/generate-and-schedule/rollback-refund';
import type { CreateExperimentBody, CreateExperimentResponse } from '@/lib/contracts/experiments';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import { computeVideoTokens, toFiniteNumber, type FaceQuality } from '@/lib/tokens';
import { planExperimentSlots } from './plan-experiment';

export type CreateExperimentOutcome =
  | { ok: true; value: CreateExperimentResponse }
  | { ok: false; status: number; error: string; have?: number; need?: number };

function isProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

export async function createExperiment(
  supabase: SupabaseClient,
  userId: string,
  body: CreateExperimentBody,
): Promise<CreateExperimentOutcome> {
  const plan = planExperimentSlots(body);
  if (!plan.ok) return { ok: false, status: 400, error: plan.error };
  for (const provider of body.providers) {
    if (!isProvider(provider)) return { ok: false, status: 400, error: `Unknown provider "${provider}".` };
  }
  const personaResult = await supabase
    .from('personas')
    .select('id, face_quality')
    .eq('id', body.personaId)
    .eq('user_id', userId)
    .single();
  if (personaResult.error || personaResult.data === null) {
    return { ok: false, status: 404, error: 'Persona not found.' };
  }
  const faceQuality: FaceQuality = personaResult.data.face_quality === 'very_good' ? 'very_good' : 'ok';
  const promptIds = body.prompts.map((prompt) => prompt.promptVersionId);
  const versionsResult = await supabase.from('prompt_versions').select('id, owner_id, source').in('id', promptIds);
  if (versionsResult.error) return { ok: false, status: 500, error: 'Failed to load prompt versions.' };
  const versions = versionsResult.data ?? [];
  for (const promptId of promptIds) {
    const version = versions.find((row) => row.id === promptId);
    if (version === undefined) return { ok: false, status: 404, error: `Unknown promptVersionId ${promptId}.` };
    if (version.source !== 'official' && version.owner_id !== userId) {
      return { ok: false, status: 404, error: `Unknown promptVersionId ${promptId}.` };
    }
  }
  const perVideoCost = computeVideoTokens(body.videoType, faceQuality);
  const totalVideos = plan.slots.length;
  const totalTokens = perVideoCost * totalVideos;
  const experimentId = randomUUID();
  const spend = await supabase.rpc('spend_tokens', {
    p_user_id: userId,
    p_amount: totalTokens,
    p_generation_id: `batch:${experimentId}`,
    p_reason: `Experiment ${body.name} (${totalVideos} videos)`,
  });
  if (spend.error) return { ok: false, status: 500, error: 'Failed to charge tokens.' };
  const spendRecord = (spend.data ?? {}) as { spent?: unknown; balance?: unknown };
  if (spendRecord.spent !== true) {
    return {
      ok: false,
      status: 402,
      error: 'Insufficient tokens for this experiment.',
      have: toFiniteNumber(spendRecord.balance, 0),
      need: totalTokens,
    };
  }
  const rollback = async (): Promise<void> => {
    await supabase.from('scheduled_posts').delete().eq('experiment_id', experimentId).eq('user_id', userId);
    await supabase.from('experiments').delete().eq('id', experimentId).eq('user_id', userId);
    await refundRollbackSpend(supabase, {
      userId,
      generationId: `batch:${experimentId}`,
      amount: totalTokens,
      reason: 'Experiment creation failed; tokens refunded',
      failureLog: '[experiments] rollback refund failed',
    });
  };
  const experimentInsert = await supabase.from('experiments').insert({
    id: experimentId,
    user_id: userId,
    name: body.name,
    persona_id: body.personaId,
    prompt_version_ids: promptIds,
    videos_per_prompt: body.videosPerPrompt,
    posts_per_day: body.postsPerDay,
    video_type: body.videoType,
    status: 'active',
  });
  if (experimentInsert.error) {
    await refundRollbackSpend(supabase, {
      userId,
      generationId: `batch:${experimentId}`,
      amount: totalTokens,
      reason: 'Experiment creation failed; tokens refunded',
      failureLog: '[experiments] rollback refund failed',
    });
    return { ok: false, status: 500, error: 'Failed to create the experiment.' };
  }
  const accounts: Partial<Record<SocialProvider, string[]>> = {};
  for (const [provider, ids] of Object.entries(body.accounts ?? {})) {
    if (isProvider(provider)) accounts[provider] = ids;
  }
  const sortedTimes = [...new Set(body.times.map((time) => time.trim()))].sort();
  const scheduleIds = plan.slots.map(() => randomUUID());
  const scheduleRows = scheduleIds.map((scheduleId) => ({
    id: scheduleId,
    user_id: userId,
    persona_id: body.personaId,
    providers: body.providers,
    ...scheduleAccountColumns(accounts),
    pinterest_board_id: null,
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: body.postsPerDay,
    times: sortedTimes,
    timezone: body.timezone,
    scheduled_at: null,
    active: true,
    publish_mode: 'scheduled',
  }));
  const scheduleInsert = await supabase.from('schedules').insert(scheduleRows);
  if (scheduleInsert.error) {
    await rollback();
    return { ok: false, status: 500, error: 'Failed to create the experiment schedules.' };
  }
  const slotRows = plan.slots.map((slot, index) => ({
    schedule_id: scheduleIds[index],
    user_id: userId,
    slot_at: slot.slotAtISO,
    status: 'pending',
    title: slot.title,
    description: slot.description,
    video_type: body.videoType,
    voiceover: body.videoType === 'voiceover',
    full_lipsync: body.videoType === 'full_lipsync',
    charged_tokens: perVideoCost,
    segments: slot.segments ?? null,
    prompt_version_id: slot.promptVersionId,
    experiment_id: experimentId,
    batch_id: experimentId,
  }));
  const slotInsert = await supabase.from('scheduled_posts').insert(slotRows).select('id, slot_at, title, prompt_version_id');
  if (slotInsert.error || slotInsert.data === null || slotInsert.data.length !== slotRows.length) {
    await supabase.from('schedules').delete().in('id', scheduleIds).eq('user_id', userId);
    await rollback();
    return { ok: false, status: 500, error: 'Failed to create the experiment videos.' };
  }
  return {
    ok: true,
    value: {
      success: true,
      experimentId,
      scheduleIds,
      slots: slotInsert.data.map((slot) => ({
        slotId: slot.id,
        slotAt: slot.slot_at,
        promptVersionId: slot.prompt_version_id ?? '',
        title: slot.title,
      })),
      totalVideos,
      totalTokens,
      endAt: plan.endAt,
    },
  };
}
