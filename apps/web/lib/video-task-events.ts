//---------------
// SSE progress snapshots for video tasks.
// The engine streams `data: {task_id, state, progress, stage}` lines over
// GET /api/v1/tasks/:taskId/events; the Next proxy at
// /api/persona/video-events/:taskId forwards them (EventSource cannot send
// the Authorization header the engine requires, so the browser talks to
// the cookie-authenticated proxy instead).
//---------------

import { useEffect, useRef } from 'react';

export interface VideoTaskSnapshot {
  taskId: string;
  state: number;
  progress: number;
  stage: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

//---------------
// parseSseSnapshot — parse one SSE line. Returns null for heartbeats,
// comments, and malformed payloads (never throws).
//---------------
export function parseSseSnapshot(line: string): VideoTaskSnapshot | null {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice('data:'.length).trim();
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { task_id, state, progress, stage } = value;
  if (typeof task_id !== 'string') return null;
  if (typeof state !== 'number') return null;
  if (typeof progress !== 'number') return null;
  return {
    taskId: task_id,
    state,
    progress,
    stage: typeof stage === 'string' ? stage : null,
  };
}

//---------------
// isTerminalSnapshot — the engine closes the stream after these states;
// the client should do its final status fetch (history/refund side
// effects live on the video-status proxy).
//---------------
export function isTerminalSnapshot(snapshot: VideoTaskSnapshot): boolean {
  return snapshot.state === 1 || snapshot.state === -1;
}

export interface VideoTaskEventsCallbacks {
  onSnapshot: (snapshot: VideoTaskSnapshot) => void;
  onStreamError: (error: Error) => void;
}

//---------------
// useVideoTaskEvents — subscribe to a task's SSE progress stream.
// Opens one EventSource per taskId; closes it on unmount, on stream
// error, or right after a terminal snapshot (the stream is closed
// server-side too, this just releases the client promptly).
//---------------
export function useVideoTaskEvents(
  taskId: string | null,
  callbacks: VideoTaskEventsCallbacks,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!taskId) return;
    const source = new EventSource(
      `/api/persona/video-events/${encodeURIComponent(taskId)}`,
    );
    source.onmessage = (event: MessageEvent) => {
      const snapshot = parseSseSnapshot(`data: ${String(event.data)}`);
      if (!snapshot) return;
      callbacksRef.current.onSnapshot(snapshot);
      if (isTerminalSnapshot(snapshot)) source.close();
    };
    source.onerror = () => {
      callbacksRef.current.onStreamError(
        new Error('Video progress stream disconnected.'),
      );
      source.close();
    };
    return () => source.close();
  }, [taskId]);
}
