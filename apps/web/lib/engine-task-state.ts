//---------------
// engine-task-state — parsing helpers for the engine's task payload.
//
// The engine wraps the task under `data` and reports progress as a
// numeric `state` (-1 failed, 1 complete, 3 queued, 4 processing),
// alongside a string `status` like "publishing". Some shapes only carry
// a string status. The numeric state wins when present because the
// string status is not terminal-oriented.
//
// Shared by the video-status proxy route and the billing reconciliation
// (both need the same terminal-state reading of one engine response).
//---------------

export function taskPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const body = record.body;
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return record;
}

export function taskState(task: Record<string, unknown>): number | null {
  for (const candidate of [task.state, task.task_state]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^-?\d+$/.test(candidate.trim())) {
      return parseInt(candidate.trim(), 10);
    }
  }
  return null;
}

//---------------
// extractTaskError — the engine stores the failure reason in the task's
// `error` field; the status proxy passes it through. Returns null when the
// body carries no usable error text.
//---------------
export function extractTaskError(value: unknown): string | null {
  const task = taskPayload(value);
  if (!task) return null;
  const candidate = task.error;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
