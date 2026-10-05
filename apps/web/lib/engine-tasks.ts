import { engineAuthHeaders } from '@/lib/request-auth';
import { SAFE_TASK_ID } from './video-urls';

//---------------
// engine-tasks — pure-read engine task lookups (no side effects).
//
// Unlike GET /api/persona/video-status/[taskId] — which advances the
// video_generations history row and refunds on terminal states — these
// helpers NEVER write. They only fetch the engine task record so list
// endpoints (e.g. GET /api/schedule/status) can surface live progress
// without changing any billing or history state.
//---------------

//---------------
// ENGINE_TASK_PROGRESS_TIMEOUT_MS — the status list is read live while
// the user watches video progress; a hung engine must degrade the slot
// to 0 (caught by the caller) instead of blocking the whole request.
//---------------
export const ENGINE_TASK_PROGRESS_TIMEOUT_MS = 10_000;

//---------------
// TASK_STATE_FAILED — the engine's numeric failed state (const.py). A gone
// task is reported with it so every consumer can treat "engine forgot the
// task" and "engine says the task failed" through one terminal branch.
//---------------
export const TASK_STATE_FAILED = -1;

//---------------
// clampProgress — engine progress is documented 0–100 (state.py clamps on
// write); clamp again defensively and coerce non-numeric payloads to 0 so
// a malformed engine response can never surface as 137% or NaN.
//---------------
export function clampProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export interface EngineTaskProgress {
  progress: number;
  stage: string | null;
  state: number | null;
  //---------------
  // gone — the engine answered 404: it no longer knows this task (an engine
  // restart dropped it, or the state backend lost it). This is TERMINAL,
  // unlike every other lookup failure: polling again can only 404 forever.
  // The caller must stop polling AND settle the generation row, or the
  // history shows a task that will never finish. A 5xx/abort/network error
  // stays a throw — that one is transient and must be retried.
  //---------------
  gone: boolean;
}

//---------------
// taskPayload — the engine wraps the task record under `body`; some
// shapes return it unwrapped. Mirrors the video-status route's parsing
// (read-only subset: no terminal-state detection here).
//---------------
function taskPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const body = record.body;
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return record;
}

function taskState(task: Record<string, unknown>): number | null {
  for (const candidate of [task.state, task.task_state]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^-?\d+$/.test(candidate.trim())) {
      return parseInt(candidate.trim(), 10);
    }
  }
  return null;
}

//---------------
// taskStage — the engine reports the current pipeline stage as a string
// (e.g. "lipsync"); repass non-empty strings as-is, null otherwise.
//---------------
function taskStage(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

//---------------
// fetchEngineTaskProgress — GET {MONEYPRINT_API_URL}/api/v1/tasks/{taskId}
// with the engine auth headers. Strictly a read: no refunds, no history
// writes, no video URL rewriting.
//
// Throws when the task id is unsafe, the engine is unconfigured, or the
// lookup fails — the caller decides the fallback (the status list degrades
// a single slot to progress 0 instead of failing the whole request).
//---------------
export async function fetchEngineTaskProgress(
  taskId: string,
  userId: string,
): Promise<EngineTaskProgress> {
  if (!SAFE_TASK_ID.test(taskId)) {
    throw new Error(`Invalid taskId: ${taskId}`);
  }
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TASK_PROGRESS_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: engineAuthHeaders(userId),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    // A 404 is a terminal answer, not a transport failure: the engine
    // forgot the task. Report it as gone (state -1) so callers stop
    // polling instead of retrying a resource that can never come back.
    if (response.status === 404) {
      return { progress: 0, stage: null, state: TASK_STATE_FAILED, gone: true };
    }
    if (!response.ok) {
      throw new Error(`Engine task lookup failed with status ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    const task = taskPayload(body);
    return {
      progress: task ? clampProgress(task.progress) : 0,
      stage: task ? taskStage(task.stage) : null,
      state: task ? taskState(task) : null,
      gone: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

//---------------
// fetchEnginePublishResults — read the raw publish_results array the engine
// recorded for a task (one entry per provider it published to).
//
// Kept separate from fetchEngineTaskProgress on purpose: the returned
// payload is handed straight to resolvePublishLinks, which owns the
// per-provider URL derivation and the validation of every field. This
// function only fetches; it never interprets.
//
// Throws on the same conditions as fetchEngineTaskProgress (unsafe id,
// unconfigured engine, failed lookup) — the caller decides the fallback.
//---------------
export async function fetchEnginePublishResults(
  taskId: string,
  userId: string,
): Promise<unknown[]> {
  if (!SAFE_TASK_ID.test(taskId)) {
    throw new Error(`Invalid taskId: ${taskId}`);
  }
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TASK_PROGRESS_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: engineAuthHeaders(userId),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Engine task lookup failed with status ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    const task = taskPayload(body);
    const results = task ? task.publish_results : null;
    return Array.isArray(results) ? results : [];
  } finally {
    clearTimeout(timeout);
  }
}
