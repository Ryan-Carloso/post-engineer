import { useVideoTaskEvents, type VideoTaskSnapshot } from '@/lib/video-task-events';
import type { BatchVideo } from '@/lib/video-batch';

//---------------
// BatchVideoRow — one SSE stream per video in a debug batch. The parent
// owns the videos state (batchVideosReducer); the row only forwards its
// own task's snapshots. The stream opens while the video is queued or
// generating and closes on unmount or right after a terminal snapshot
// (the hook closes the EventSource itself; passing null on terminal
// states keeps the effect from reopening it).
//---------------
export const BatchVideoRow = ({
  video,
  index,
  total,
  onSnapshot,
  onStreamError,
}: {
  video: BatchVideo;
  index: number;
  total: number;
  onSnapshot: (taskId: string, snapshot: VideoTaskSnapshot) => void;
  onStreamError: (taskId: string) => void;
}) => {
  const active = video.status === 'queued' || video.status === 'generating';
  useVideoTaskEvents(active ? video.taskId : null, {
    onSnapshot: (snapshot: VideoTaskSnapshot) => onSnapshot(video.taskId, snapshot),
    onStreamError: () => onStreamError(video.taskId),
  });

  const percentage = Math.round(video.progress * 100);
  const label =
    video.status === 'done'
      ? `vídeo ${index + 1}/${total}: ✓ pronto`
      : video.status === 'failed'
        ? `vídeo ${index + 1}/${total}: ✗ falhou`
        : video.status === 'queued'
          ? `vídeo ${index + 1}/${total}: na fila`
          : `vídeo ${index + 1}/${total}: ${percentage}%`;

  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-200" data-testid={`debug-video-${index}-label`}>
          {label}
        </p>
        {video.status === 'done' && video.downloadUrl ? (
          <a
            data-testid={`debug-video-${index}-download`}
            href={video.downloadUrl}
            download={`post-engineer-debug-${index + 1}.mp4`}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Baixar
          </a>
        ) : null}
      </div>
      <p className="truncate text-xs text-neutral-400" title={video.topic}>
        {video.topic}
      </p>
      {video.status === 'generating' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percentage}%` }} />
        </div>
      ) : null}
      {video.status === 'failed' && video.error ? (
        <p role="alert" className="text-xs text-red-400">
          {video.error}
        </p>
      ) : null}
    </div>
  );
};
