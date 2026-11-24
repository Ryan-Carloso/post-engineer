export const PROGRESS_POLL_FLOOR_SECONDS = 60;

export const PROGRESS_POLL_EARLY_SECONDS = 120;

export function nextPollInSeconds(state: number | null, progress: number | null): number | undefined {
  if (state === 1 || state === -1) return undefined;
  const fraction =
    progress === null || !Number.isFinite(progress) ? 0 : Math.min(1, Math.max(0, progress / 100));
  const span = PROGRESS_POLL_EARLY_SECONDS - PROGRESS_POLL_FLOOR_SECONDS;
  return PROGRESS_POLL_FLOOR_SECONDS + Math.round(span * (1 - fraction));
}
