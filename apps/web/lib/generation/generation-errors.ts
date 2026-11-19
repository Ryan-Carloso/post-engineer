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
  if ((GENERATION_ERROR_CODES as readonly string[]).includes(text)) {
    return text as GenerationErrorCode;
  }
  if (text.includes('engine restart')) return 'engine_restart';
  if (text.includes('custom audio')) return 'custom_audio_invalid';
  if (text.includes('unavailable')) return 'engine_unavailable';
  if (text.includes('rejected the job')) return 'engine_rejected';
  if (text.includes('no task id')) return 'no_task_id';
  if (text.includes('invalid task response')) return 'invalid_task_response';
  return 'unknown';
}

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
