//---------------
// Generation error categories — machine-friendly codes derived from raw
// engine/upstream error text. The web stores the code alongside the raw
// message; the UI maps the code to a translated, actionable message and
// falls back to the raw text when no mapping exists.
//---------------

export type GenerationErrorCode =
  | 'custom_audio_invalid'
  | 'engine_unavailable'
  | 'engine_rejected'
  | 'no_task_id'
  | 'invalid_task_response'
  | 'unknown';

export function categorizeGenerationError(
  raw: string | null | undefined,
): GenerationErrorCode {
  if (!raw) return 'unknown';
  const text = raw.toLowerCase();
  if (text.includes('custom audio')) return 'custom_audio_invalid';
  if (text.includes('unavailable')) return 'engine_unavailable';
  if (text.includes('rejected the job')) return 'engine_rejected';
  if (text.includes('no task id')) return 'no_task_id';
  if (text.includes('invalid task response')) return 'invalid_task_response';
  return 'unknown';
}

//---------------
// isRetryableGenerationError — does this failure look transient, i.e.
// would retrying the generation plausibly succeed? Documented mapping:
//   engine_unavailable    -> true  (transient: the engine/network blipped)
//   invalid_task_response -> true  (transient: a malformed response)
//   custom_audio_invalid  -> false (validation: the input audio is bad)
//   engine_rejected       -> false (the engine refused the job)
//   no_task_id            -> false (internal bookkeeping bug, not the job)
//   unknown               -> keyword scan: rate-limit/network/timeout-like
//                            text is retryable; everything else (auth,
//                            quota, unrecognized) fails closed at false.
//---------------
const RETRYABLE_CATEGORIES: ReadonlySet<GenerationErrorCode> = new Set([
  'engine_unavailable',
  'invalid_task_response',
]);

const TRANSIENT_KEYWORDS = /rate.?limit|429|timeout|timed out|network|econn|socket/i;

export function isRetryableGenerationError(raw: string | null | undefined): boolean {
  const category = categorizeGenerationError(raw);
  if (category !== 'unknown') return RETRYABLE_CATEGORIES.has(category);
  return TRANSIENT_KEYWORDS.test(raw ?? '');
}
