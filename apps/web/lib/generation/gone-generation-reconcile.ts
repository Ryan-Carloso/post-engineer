import type { SupabaseClient } from '@supabase/supabase-js';

//---------------
// gone-generation-reconcile — resolve which generation a dead engine task
// belongs to, so a task the engine forgot can still settle its history row.
//
// WHY THIS EXISTS: the video-status route resolves the generation through
// token_transactions by engine_task_id. That lookup only works for DIRECT
// generations. A batch (scheduled) post is charged ONCE under
// `batch:<schedule_id>` with engine_task_id NULL, while each slot's
// video_generations row uses `batch:<schedule_id>:slot:<slot_id>`. The
// task-id lookup therefore found nothing for every scheduled post, the
// failure path returned early, and the history row stayed `running`
// forever while the UI polled a task the engine had already dropped.
//
// Two lookups, in order:
//   1. video_generations by engine_task_id — the authoritative link, and the
//      only one that can name the exact generation for a direct post.
//   2. token_transactions by the batch prefix — the prepaid-batch case.
//      A batch charge is settled with refund_batch_tokens (whole-batch
//      semantics owned by the engine's batch runner), so the value returned
//      here is a BILLING key, not always the row to patch. Callers must
//      treat the two differently; see settleGoneGeneration.
//---------------

//---------------
// BATCH_GENERATION_PREFIX — every batch charge/slot id starts with this.
//---------------
export const BATCH_GENERATION_PREFIX = 'batch:';

//---------------
// SLOT_GENERATION_SEPARATOR — a slot id is `<batch>:slot:<slot_id>`.
//---------------
const SLOT_GENERATION_SEPARATOR = ':slot:';

//---------------
// batchGenerationId — strip the `:slot:<id>` suffix to get the batch charge
// id. Idempotent for an id that already IS the batch id, and a non-batch id
// is returned unchanged so a direct generation never gets rewritten into a
// bogus `batch:` lookup.
//---------------
export function batchGenerationId(generationId: string): string {
  const marker = generationId.indexOf(SLOT_GENERATION_SEPARATOR);
  if (marker === -1) return generationId;
  return generationId.slice(0, marker);
}

function isGenerationId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

//---------------
// resolveGoneGenerationId — the generation to settle for a dead task.
//
// Returns undefined when nothing provably belongs to this task: an
// unresolvable task must NOT be guessed into a refund, since a wrong match
// refunds another generation's tokens. A query ERROR is thrown (not
// swallowed into undefined) so the caller can distinguish "nothing to
// settle" from "could not check" — the billing rule that a failed check
// logs loudly rather than looking like a clean no-op.
//
// Service-role callers bypass RLS, so every query is explicitly scoped by
// user_id; ownership is never inferred from the task id.
//---------------
export async function resolveGoneGenerationId(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<string | undefined> {
  const { data: byTask, error: byTaskError } = await supabase
    .from('video_generations')
    .select('generation_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (byTaskError) throw new Error(`generation lookup by task id failed: ${byTaskError.message}`);
  if (isGenerationId(byTask?.generation_id)) return byTask.generation_id;

  // No video_generations row names the task id. A scheduled post's slot
  // row always carries one, so this is the defensive path — but it is also
  // the only way to reach the prepaid batch charge when the slot row is
  // missing entirely. Derive the batch id from the SLOT row (bounded, one
  // indexed lookup by task_id) rather than scanning the user's ledger.
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
  return isGenerationId(charge?.generation_id) ? charge.generation_id : undefined;
}