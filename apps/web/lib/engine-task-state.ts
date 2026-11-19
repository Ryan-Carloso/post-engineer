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

export function extractTaskError(value: unknown): string | null {
  const task = taskPayload(value);
  if (!task) return null;
  const candidate = task.error;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

const FAILED_STATUS_STRINGS = ['failed', 'failure', 'error'];
const COMPLETED_STATUS_STRINGS = ['completed', 'complete', 'done', 'success'];
const PENDING_STATUS_STRINGS = ['queued', 'processing', 'pending', 'running', 'started'];

function hasStringState(task: Record<string, unknown>, values: readonly string[]): boolean {
  return [task.status, task.task_status].some(
    (candidate) => typeof candidate === 'string' && values.includes(candidate.toLowerCase()),
  );
}

function matchesTaskState(value: unknown, states: readonly number[], strings: readonly string[]): boolean {
  const task = taskPayload(value);
  if (!task) return false;
  const state = taskState(task);
  if (state !== null) return states.includes(state);
  return hasStringState(task, strings);
}

export function isFailedVideoStatus(value: unknown): boolean {
  return matchesTaskState(value, [-1], FAILED_STATUS_STRINGS);
}

export function isCompletedVideoStatus(value: unknown): boolean {
  return matchesTaskState(value, [1], COMPLETED_STATUS_STRINGS);
}

export function isPendingVideoStatus(value: unknown): boolean {
  return matchesTaskState(value, [3, 4], PENDING_STATUS_STRINGS);
}
