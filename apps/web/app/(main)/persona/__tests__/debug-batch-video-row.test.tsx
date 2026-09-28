// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';

vi.mock('@/lib/video-task-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-task-events')>();
  // Only the SSE subscription is mocked; the snapshot parsers stay real.
  return { ...actual, useVideoTaskEvents: vi.fn() };
});

import {
  useVideoTaskEvents,
  isTerminalSnapshot,
  type VideoTaskSnapshot,
} from '@/lib/video-task-events';
import { BatchVideoRow } from '../debug-batch-video-row';
import {
  batchVideosReducer,
  initBatchVideos,
  type BatchVideo,
} from '@/lib/video-batch';

const hookMock = vi.mocked(useVideoTaskEvents);

type RowCallbacks = {
  onSnapshot: (snapshot: VideoTaskSnapshot) => void;
  onStreamError: () => void;
};

const callbacksFor = (taskId: string): RowCallbacks | undefined => {
  const calls = hookMock.mock.calls.filter(([id]) => id === taskId);
  const latest = calls[calls.length - 1];
  return latest?.[1] as RowCallbacks | undefined;
};

const subscribedTaskIds = (): (string | null)[] => hookMock.mock.calls.map(([id]) => id);

//---------------
// Wrapper owns the videos state like PersonaDebugSubmit does (the
// terminal-status GET is skipped: the snapshot→terminal reducer
// transition is what this test pins).
//---------------
const BatchWrapper = ({ topics }: { topics: string[] }) => {
  const [videos, setVideos] = useState<BatchVideo[]>(() =>
    initBatchVideos(
      topics.map((_, index) => `task-${index}`),
      topics,
    ),
  );

  const handleSnapshot = (taskId: string, snapshot: VideoTaskSnapshot): void => {
    const terminal = isTerminalSnapshot(snapshot);
    setVideos((current) =>
      batchVideosReducer(current, {
        type: 'snapshot',
        taskId,
        progress: snapshot.progress,
        stage: snapshot.stage,
        terminal,
      }),
    );
    if (terminal) {
      setVideos((current) =>
        batchVideosReducer(current, {
          type: 'terminal',
          taskId,
          outcome: snapshot.state === -1 ? 'failed' : 'done',
          error: snapshot.state === -1 ? 'boom' : undefined,
          downloadUrl: snapshot.state === -1 ? undefined : `/dl/${taskId}.mp4`,
        }),
      );
    }
  };

  const handleStreamError = (taskId: string): void => {
    setVideos((current) => batchVideosReducer(current, { type: 'stream-error', taskId }));
  };

  return (
    <>
      {videos.map((video, index) => (
        <BatchVideoRow
          key={video.taskId}
          video={video}
          index={index}
          total={videos.length}
          onSnapshot={handleSnapshot}
          onStreamError={handleStreamError}
        />
      ))}
    </>
  );
};

const progressSnapshot = (overrides: Partial<VideoTaskSnapshot> = {}): VideoTaskSnapshot => ({
  taskId: 'task-0',
  state: 4,
  progress: 0.6,
  stage: 'render',
  ...overrides,
});

beforeEach(() => {
  hookMock.mockClear();
});

describe('BatchVideoRow', () => {
  it('opens one SSE stream per task, each starting queued', () => {
    render(<BatchWrapper topics={['one', 'two']} />);
    expect(subscribedTaskIds()).toEqual(expect.arrayContaining(['task-0', 'task-1']));
    expect(screen.getByTestId('debug-video-0-label')).toHaveTextContent('vídeo 1/2: na fila');
    expect(screen.getByTestId('debug-video-1-label')).toHaveTextContent('vídeo 2/2: na fila');
  });

  it('advances only the video whose stream fired the snapshot', () => {
    render(<BatchWrapper topics={['one', 'two']} />);
    const callbacks = callbacksFor('task-0');
    expect(callbacks).toBeDefined();
    act(() => {
      callbacks?.onSnapshot(progressSnapshot());
    });
    expect(screen.getByTestId('debug-video-0-label')).toHaveTextContent('vídeo 1/2: 60%');
    expect(screen.getByTestId('debug-video-1-label')).toHaveTextContent('vídeo 2/2: na fila');
  });

  it('closes the stream and shows the download when the video completes', () => {
    render(<BatchWrapper topics={['one', 'two']} />);
    act(() => {
      callbacksFor('task-0')?.onSnapshot(progressSnapshot({ state: 1, progress: 1 }));
    });
    expect(screen.getByTestId('debug-video-0-label')).toHaveTextContent('vídeo 1/2: ✓ pronto');
    const download = screen.getByTestId('debug-video-0-download');
    expect(download).toHaveAttribute('href', '/dl/task-0.mp4');
    // The finished task's stream is closed; the sibling's stays open.
    expect(subscribedTaskIds()).toContain(null);
    expect(screen.getByTestId('debug-video-1-label')).toHaveTextContent('vídeo 2/2: na fila');
  });

  it('shows a failed video without stopping its siblings', () => {
    render(<BatchWrapper topics={['one', 'two']} />);
    act(() => {
      callbacksFor('task-0')?.onSnapshot(progressSnapshot({ state: -1, progress: 0.4 }));
    });
    expect(screen.getByTestId('debug-video-0-label')).toHaveTextContent('vídeo 1/2: ✗ falhou');
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByTestId('debug-video-1-label')).toHaveTextContent('vídeo 2/2: na fila');
    // The failed video has no download link; the sibling is untouched.
    expect(screen.queryByTestId('debug-video-0-download')).not.toBeInTheDocument();
    expect(callbacksFor('task-1')).toBeDefined();
  });

  it('marks a disconnected stream failed without touching the other video', () => {
    render(<BatchWrapper topics={['one', 'two']} />);
    act(() => {
      callbacksFor('task-0')?.onSnapshot(progressSnapshot());
      callbacksFor('task-1')?.onStreamError();
    });
    expect(screen.getByTestId('debug-video-0-label')).toHaveTextContent('vídeo 1/2: 60%');
    expect(screen.getByTestId('debug-video-1-label')).toHaveTextContent('vídeo 2/2: ✗ falhou');
    expect(screen.getByRole('alert')).toHaveTextContent('Video progress stream disconnected.');
  });
});
