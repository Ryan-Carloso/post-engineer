//---------------
// DEBUG mode helper: normalizes the engine's task response.
// Generation itself runs in /api/persona/video-job, sharing the ENTIRE
// normal flow (schema, payload, moderation/token gate).
//---------------

export interface DebugTaskResponse {
  taskId: string;
  state?: number;
  progress?: number;
  error?: string;
}

export function normalizeDebugTaskResponse(value: unknown): DebugTaskResponse | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.data) ? value.data : value;
  if (typeof candidate.task_id !== 'string') return null;
  return {
    taskId: candidate.task_id,
    state: typeof candidate.state === 'number' ? candidate.state : undefined,
    progress: typeof candidate.progress === 'number' ? candidate.progress : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
