//---------------
// Generation error categories — machine-friendly codes derived from raw
// engine/upstream error text, plus codes the engine writes directly to
// video_generations (e.g. engine_restart on boot-reconciled orphans). The
// web stores the code alongside the raw message; the UI maps the code to
// a translated, actionable message and falls back to the raw text when no
// mapping exists.
//
// GENERATION_ERROR_CODES is the runtime list behind the union: the sync
// test pins that every error_code the engine writes is a member, so the
// two apps can't drift on the contract.
//---------------

import type { TranslationKey } from '@/lib/i18n';

export const GENERATION_ERROR_CODES = [
  'custom_audio_invalid',
  'engine_unavailable',
  'engine_rejected',
  'no_task_id',
  'invalid_task_response',
  'engine_restart',
  'unknown',
] as const;

export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number];

//---------------
// GENERATION_ERROR_KEY — code to translated UI message. Every union member
// must have an entry; the sync test pins this against both dictionaries.
// The map stays Record<string, ...> because VideoGeneration.errorCode is
// stringly typed at the API boundary; unknown codes fall back to
// posts.errorUnknown at the call site.
//---------------
export const GENERATION_ERROR_KEY: Record<string, TranslationKey> = {
  custom_audio_invalid: 'posts.errorCustomAudio',
  engine_unavailable: 'posts.errorEngineUnavailable',
  engine_rejected: 'posts.errorEngineRejected',
  no_task_id: 'posts.errorNoTaskId',
  invalid_task_response: 'posts.errorInvalidTaskResponse',
  engine_restart: 'posts.errorEngineRestart',
  unknown: 'posts.errorUnknown',
};

export function categorizeGenerationError(
  raw: string | null | undefined,
): GenerationErrorCode {
  if (!raw) return 'unknown';
  const text = raw.toLowerCase();
  // Codes round-trip: the engine sometimes stores the code itself
  // (e.g. engine_restart on boot-reconciled orphans).
  if ((GENERATION_ERROR_CODES as readonly string[]).includes(text)) {
    return text as GenerationErrorCode;
  }
  // Engine orphan contract: tasks failed by the boot reconcile carry the
  // engine's _ORPHAN_ERROR_MESSAGE sentence in data.error (see state.py).
  // The web's video-status poll re-categorizes from that sentence when the
  // refund backstop runs — without this rule it would downgrade the stored
  // engine_restart code to unknown and lose the retryable classification.
  if (text.includes('engine restart')) return 'engine_restart';
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
//   engine_restart        -> true  (transient: the engine restarted
//                            mid-generation; the token was refunded)
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
  'engine_restart',
]);

const TRANSIENT_KEYWORDS = /rate.?limit|429|timeout|timed out|network|econn|socket/i;

export function isRetryableGenerationError(raw: string | null | undefined): boolean {
  const category = categorizeGenerationError(raw);
  if (category !== 'unknown') return RETRYABLE_CATEGORIES.has(category);
  return TRANSIENT_KEYWORDS.test(raw ?? '');
}
