import type { SupabaseClient } from '@supabase/supabase-js';

export const BATCH_GENERATION_PREFIX = 'batch:';

export const SLOT_GENERATION_SEPARATOR = ':slot:';

export function batchGenerationId(generationId: string): string {
  const marker = generationId.indexOf(SLOT_GENERATION_SEPARATOR);
  if (marker === -1) return generationId;
  return generationId.slice(0, marker);
}

function isGenerationId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface GoneGenerationResolution {
  generationId: string;
  batchChargeKey: boolean;
}

export async function resolveGoneGenerationId(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<GoneGenerationResolution | undefined> {
  const { data: byTask, error: byTaskError } = await supabase
    .from('video_generations')
    .select('generation_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (byTaskError) throw new Error(`generation lookup by task id failed: ${byTaskError.message}`);
  if (isGenerationId(byTask?.generation_id)) {
    return { generationId: byTask.generation_id, batchChargeKey: false };
  }

  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('schedule_id')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (slotError) throw new Error(`slot lookup by task id failed: ${slotError.message}`);
  const scheduleId = slot?.schedule_id;
  if (typeof scheduleId !== 'string' || scheduleId.length === 0) return undefined;

  const { data: charge, error: chargeError } = await supabase
    .from('token_transactions')
    .select('generation_id')
    .eq('user_id', userId)
    .eq('generation_id', `${BATCH_GENERATION_PREFIX}${scheduleId}`)
    .eq('type', 'video_generation')
    .limit(1)
    .maybeSingle();
  if (chargeError) throw new Error(`batch charge lookup failed: ${chargeError.message}`);
  if (isGenerationId(charge?.generation_id)) {
    return { generationId: charge.generation_id, batchChargeKey: true };
  }
  return undefined;
}