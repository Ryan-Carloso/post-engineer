export const PREFLIGHT_CONCURRENCY = 4;

export const EXPERIMENT_PREFLIGHT_BUDGET_MS = 60_000;

export const FULL_LIPSYNC_NARRATION_CHECK_MS = 10_000;

export const LIPSYNC_PHOTO_CHECK_ROUNDS = 1;

export function fullLipsyncVideoCap(
  budgetMs: number = EXPERIMENT_PREFLIGHT_BUDGET_MS,
  concurrency: number = PREFLIGHT_CONCURRENCY,
  narrationCheckMs: number = FULL_LIPSYNC_NARRATION_CHECK_MS,
): number {
  const rounds = Math.floor(budgetMs / narrationCheckMs) - LIPSYNC_PHOTO_CHECK_ROUNDS;
  return Math.max(0, rounds) * concurrency;
}
