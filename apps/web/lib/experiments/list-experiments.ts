import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExperimentProgress } from '@/lib/contracts/experiments';

interface ExperimentRow {
  id: string;
  name: string;
  persona_id: string;
  prompt_version_ids: string[];
  videos_per_prompt: number;
  posts_per_day: number;
  video_type: string;
  status: 'active' | 'cancelled';
  created_at: string;
}

interface SlotRow {
  prompt_version_id: string | null;
  status: string;
}

export async function listExperiments(
  supabase: SupabaseClient,
  userId: string,
  personaIds: readonly string[] | null,
): Promise<{ ok: true; value: ExperimentProgress[] } | { ok: false }> {
  const experimentsResult = await supabase
    .from('experiments')
    .select('id, name, persona_id, prompt_version_ids, videos_per_prompt, posts_per_day, video_type, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (experimentsResult.error) return { ok: false };
  const rows = ((experimentsResult.data ?? []) as ExperimentRow[]).filter(
    (row) => personaIds === null || personaIds.includes(row.persona_id),
  );
  const value: ExperimentProgress[] = [];
  for (const row of rows) {
    const slotsResult = await supabase
      .from('scheduled_posts')
      .select('prompt_version_id, status')
      .eq('experiment_id', row.id)
      .eq('user_id', userId);
    if (slotsResult.error) return { ok: false };
    const slots = (slotsResult.data ?? []) as SlotRow[];
    value.push({
      id: row.id,
      name: row.name,
      personaId: row.persona_id,
      promptVersionIds: row.prompt_version_ids,
      videosPerPrompt: row.videos_per_prompt,
      postsPerDay: row.posts_per_day,
      videoType: row.video_type,
      status: row.status,
      createdAt: row.created_at,
      progress: row.prompt_version_ids.map((promptVersionId) => {
        const own = slots.filter((slot) => slot.prompt_version_id === promptVersionId);
        return {
          promptVersionId,
          total: own.length,
          published: own.filter((slot) => slot.status === 'published').length,
          pending: own.filter((slot) => slot.status === 'pending').length,
        };
      }),
    });
  }
  return { ok: true, value };
}

export async function cancelExperiment(
  supabase: SupabaseClient,
  userId: string,
  experimentId: string,
): Promise<
  | { ok: true; value: { cancelledSlotIds: string[]; refundedTokens: number } }
  | { ok: false; status: number; error: string }
> {
  const experimentResult = await supabase
    .from('experiments')
    .select('id, persona_id, status')
    .eq('id', experimentId)
    .eq('user_id', userId)
    .single();
  if (experimentResult.error || experimentResult.data === null) {
    return { ok: false, status: 404, error: 'Experiment not found.' };
  }
  const slotsResult = await supabase
    .from('scheduled_posts')
    .select('id, status, charged_tokens, schedule_id, task_id')
    .eq('experiment_id', experimentId)
    .eq('user_id', userId)
    .eq('status', 'pending');
  if (slotsResult.error) return { ok: false, status: 500, error: 'Failed to load experiment videos.' };
  const pending = (slotsResult.data ?? []) as Array<{
    id: string;
    status: string;
    charged_tokens: number;
    schedule_id: string;
    task_id: string | null;
  }>;
  const removable = pending.filter((slot) => slot.task_id === null);
  const ids = removable.map((slot) => slot.id);
  if (ids.length > 0) {
    const deleteResult = await supabase.from('scheduled_posts').delete().in('id', ids).eq('user_id', userId);
    if (deleteResult.error) return { ok: false, status: 500, error: 'Failed to cancel experiment videos.' };
    const scheduleIds = [...new Set(removable.map((slot) => slot.schedule_id))];
    await supabase.from('schedules').delete().in('id', scheduleIds).eq('user_id', userId);
  }
  let refundedTokens = 0;
  const { batchSlotRefundKey } = await import('@/lib/billing/batch-discount');
  for (const slot of removable) {
    if (slot.charged_tokens === 0) continue;
    const outcome = await supabase.rpc('refund_batch_tokens', {
      p_user_id: userId,
      p_batch_generation_id: `batch:${experimentId}`,
      p_refund_key: batchSlotRefundKey(experimentId, slot.id),
      p_amount: slot.charged_tokens,
      p_reason: 'Experiment cancelled before publish; video refunded',
      p_engine_task_id: slot.task_id,
    });
    const refunded = outcome.error === null && (outcome.data as { refunded?: unknown } | null)?.refunded === true;
    if (refunded) refundedTokens += slot.charged_tokens;
  }
  const updateResult = await supabase
    .from('experiments')
    .update({ status: 'cancelled' })
    .eq('id', experimentId)
    .eq('user_id', userId);
  if (updateResult.error) return { ok: false, status: 500, error: 'Failed to cancel the experiment.' };
  return { ok: true, value: { cancelledSlotIds: ids, refundedTokens } };
}
