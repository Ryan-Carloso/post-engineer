//---------------
// Client-safe batch video helpers (no node: imports — this module is
// imported by the persona page). Pure logic for the debug batch flow:
// topics parsing and the per-video progress state machine. The engine runs
// batch items sequentially; the UI opens one SSE stream per task id and
// renders each video's progress independently.
//---------------

export const MAX_BATCH_TOPICS = 10;
const MAX_TOPIC_LENGTH = 300;

//---------------
// parseBatchTopicsText — one topic per line. Trims lines, drops empties;
// 1..10 topics, each 1..300 chars. A single topic is a batch of 1 — there
// is no separate single-video path in the debug flow.
//---------------
export function parseBatchTopicsText(
  text: string,
): { ok: true; topics: string[] } | { ok: false; error: string } {
  const topics = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (topics.length === 0) {
    return { ok: false, error: 'Write at least one video topic (one per line).' };
  }
  if (topics.length > MAX_BATCH_TOPICS) {
    return { ok: false, error: `A batch holds at most ${MAX_BATCH_TOPICS} videos.` };
  }
  for (const topic of topics) {
    if (topic.length > MAX_TOPIC_LENGTH) {
      return { ok: false, error: `Each topic must be at most ${MAX_TOPIC_LENGTH} characters.` };
    }
  }
  return { ok: true, topics };
}

export type BatchVideoStatus = 'queued' | 'generating' | 'done' | 'failed';

export interface BatchVideo {
  taskId: string;
  topic: string;
  progress: number;
  stage: string | null;
  status: BatchVideoStatus;
  error?: string;
  downloadUrl?: string;
}

//---------------
// initBatchVideos — one entry per task id, in request order. Videos start
// queued; the first SSE snapshot for a task flips it to generating.
//---------------
export function initBatchVideos(taskIds: string[], topics: string[]): BatchVideo[] {
  return taskIds.map((taskId, index) => ({
    taskId,
    topic: topics[index] ?? '',
    progress: 0,
    stage: null,
    status: 'queued' as BatchVideoStatus,
  }));
}

export type BatchVideosAction =
  | { type: 'snapshot'; taskId: string; progress: number; stage: string | null; terminal: boolean }
  | { type: 'terminal'; taskId: string; outcome: 'done' | 'failed'; error?: string; downloadUrl?: string }
  | { type: 'stream-error'; taskId: string };

//---------------
// batchVideosReducer — per-video progress state machine. Snapshots only
// ever touch their own taskId, so N concurrent streams stay independent;
// a failed video never changes its siblings' state (the engine keeps
// running the rest of the batch).
//---------------
export function batchVideosReducer(videos: BatchVideo[], action: BatchVideosAction): BatchVideo[] {
  switch (action.type) {
    case 'snapshot':
      return videos.map((video) =>
        video.taskId === action.taskId
          ? {
            ...video,
            progress: action.progress,
            stage: action.stage,
            status: action.terminal ? video.status : 'generating',
          }
          : video,
      );
    case 'terminal':
      return videos.map((video) =>
        video.taskId === action.taskId
          ? {
            ...video,
            status: action.outcome,
            progress: action.outcome === 'done' ? 1 : video.progress,
            error: action.error,
            downloadUrl: action.downloadUrl,
          }
          : video,
      );
    case 'stream-error':
      return videos.map((video) =>
        video.taskId === action.taskId && (video.status === 'queued' || video.status === 'generating')
          ? { ...video, status: 'failed', error: 'Video progress stream disconnected.' }
          : video,
      );
  }
}

//---------------
// allBatchVideosTerminal — the batch is over when every video reached a
// terminal status (done or failed).
//---------------
export function allBatchVideosTerminal(videos: BatchVideo[]): boolean {
  return videos.length > 0 && videos.every((video) => video.status === 'done' || video.status === 'failed');
}
