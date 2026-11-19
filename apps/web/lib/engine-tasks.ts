import { engineAuthHeaders } from '@/lib/request-auth';
import { SAFE_TASK_ID } from './video-urls';

export const ENGINE_TASK_PROGRESS_TIMEOUT_MS = 10_000;

export const ENGINE_CANCEL_TIMEOUT_MS = 3_000;
export const ENGINE_CANCEL_BUDGET_MS = 5_000;

export const TASK_STATE_FAILED = -1;

export function clampProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export interface EngineTaskProgress {
  progress: number;
  stage: string | null;
  state: number | null;
  scriptAngle: string | null;
  gone: boolean;
}

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

function taskStage(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class EngineTaskLookupError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Engine task lookup failed with status ${status}`);
    this.name = 'EngineTaskLookupError';
    this.status = status;
  }
}

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
    if (response.status === 404) {
      return { progress: 0, stage: null, state: TASK_STATE_FAILED, gone: true, scriptAngle: null };
    }
    if (!response.ok) {
      throw new EngineTaskLookupError(response.status);
    }
    const body: unknown = await response.json().catch(() => null);
    const task = taskPayload(body);
    return {
      progress: task ? clampProgress(task.progress) : 0,
      stage: task ? taskStage(task.stage) : null,
      state: task ? taskState(task) : null,
      gone: false,
      scriptAngle: task ? scriptAngleFromTask(task) : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchEnginePublishResults(
  taskId: string,
  userId: string,
): Promise<unknown[]> {
  const task = await fetchEngineTaskRecord(taskId, userId);
  const results = task ? task.publish_results : null;
  return Array.isArray(results) ? results : [];
}

export async function fetchEngineScriptAngle(
  taskId: string,
  userId: string,
): Promise<string | null> {
  const task = await fetchEngineTaskRecord(taskId, userId);
  return task ? scriptAngleFromTask(task) : null;
}

function scriptAngleFromTask(task: Record<string, unknown>): string | null {
  const angle = task.script_angle;
  if (typeof angle !== 'string') return null;
  const trimmed = angle.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchEngineTaskRecord(
  taskId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
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
      throw new EngineTaskLookupError(response.status);
    }
    const body: unknown = await response.json().catch(() => null);
    return taskPayload(body);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchEnginePostMetricsSource(
  taskId: string,
  userId: string,
): Promise<{ publishResults: unknown[]; scriptAngle: string | null }> {
  const task = await fetchEngineTaskRecord(taskId, userId);
  const results = task ? task.publish_results : null;
  const trimmed = task ? (scriptAngleFromTask(task) ?? '') : '';
  return {
    publishResults: Array.isArray(results) ? results : [],
    scriptAngle: trimmed.length > 0 ? trimmed : null,
  };
}

export async function cancelEngineTask(
  taskId: string,
  userId: string,
  timeoutMs: number = ENGINE_CANCEL_TIMEOUT_MS,
): Promise<void> {
  if (!SAFE_TASK_ID.test(taskId)) {
    throw new Error(`Invalid taskId: ${taskId}`);
  }
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'DELETE',
        headers: engineAuthHeaders(userId),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (response.ok || response.status === 404) return;
    throw new EngineTaskLookupError(response.status);
  } finally {
    clearTimeout(timeout);
  }
}
