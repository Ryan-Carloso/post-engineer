// How long an agent should wait before another progress snapshot of a
// video that is still rendering. One definition: the status answer, the
// tool description, and the recipes all point at nextPollInSeconds, and
// the number itself lives only here.
//
// Terminal engine states are 1 (complete) and -1 (failed). Everything else
// is still running (3 queued, 4 processing, or an unknown state). Early in
// the render the gap is longer; it shrinks toward the floor as progress
// approaches 100 and never goes below that floor.

/** Shortest gap between progress snapshots, in seconds. */
export const PROGRESS_POLL_FLOOR_SECONDS = 30;

/** Gap at the start of a render, before progress has moved, in seconds. */
export const PROGRESS_POLL_EARLY_SECONDS = 90;

/**
 * Seconds to wait before the next snapshot. Undefined for a terminal task:
 * the caller omits the field so the answer does not invite another poll.
 */
export function nextPollInSeconds(state: number | null, progress: number | null): number | undefined {
  if (state === 1 || state === -1) return undefined;
  const fraction =
    progress === null || !Number.isFinite(progress) ? 0 : Math.min(1, Math.max(0, progress / 100));
  const span = PROGRESS_POLL_EARLY_SECONDS - PROGRESS_POLL_FLOOR_SECONDS;
  return PROGRESS_POLL_FLOOR_SECONDS + Math.round(span * (1 - fraction));
}
