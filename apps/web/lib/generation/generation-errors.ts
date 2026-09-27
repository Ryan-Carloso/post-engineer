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
