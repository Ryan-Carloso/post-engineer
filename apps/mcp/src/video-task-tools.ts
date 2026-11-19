import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { cancelVideoTask } from './client-video-task.js';
import { ApiError, getErrorMessage } from './errors.js';
import { MAX_BATCH_VIDEOS } from './limits.js';
import { nextPollInSeconds } from './progress-poll-hint.js';
import { narrowTaskProgress } from './tools.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const CancelVideoTaskShape = {
  taskId: z
    .string()
    .min(1, 'taskId is required')
    .describe(
      'Engine task id of the video to cancel (taskId from video_tasks (action: status), posts (action: get) or posts (action: list)). Only your own task can be cancelled.',
    ),
};

export const CancelVideoTaskSchema = z.object(CancelVideoTaskShape);

export async function handleCancelVideoTask(
  client: PostEngineerClient,
  args: z.infer<typeof CancelVideoTaskSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => cancelVideoTask(client, args.taskId), 'cancelling video task');
}

export const WaitForVideoTasksShape = {
  taskIds: z
    .array(z.string().min(1, 'taskId is required'))
    .min(1, 'Provide at least one taskId')
    .max(MAX_BATCH_VIDEOS, `At most ${MAX_BATCH_VIDEOS} taskIds per call`)
    .describe(
      'Engine task IDs from generate_video, one per video (up to 12). A whole batch is one call.',
    ),
  waitSeconds: z
    .number()
    .int()
    .min(0, 'waitSeconds must be at least 0')
    .max(600, 'waitSeconds must be at most 600')
    .default(0)
    .describe('Above 0 is the final outcome: block until tasks finish (max 600). 0 is a snapshot: wait at least nextPollInSeconds. On timeout, retry unfinished taskIds.'),
};

export const WaitForVideoTasksSchema = z.object(WaitForVideoTasksShape);

export interface TaskWaitResult {
  task_id: string | null;
  state: number | null;
  outcome: 'completed' | 'failed' | 'running';
  progress: number | null;
  stage: string | null;
  error: string | null;
  postUrl: string | null;
  nextPollInSeconds?: number;
}

export interface WaitForVideoTasksDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
}

const POLL_INTERVAL_MS = 10_000;

const ENGINE_TASK_GONE_MESSAGE = 'The video task no longer exists on the generation engine.';

function attachPollHint(result: TaskWaitResult): TaskWaitResult {
  const seconds = nextPollInSeconds(result.state, result.progress);
  if (seconds === undefined) return result;
  return { ...result, nextPollInSeconds: seconds };
}

function toWaitResult(
  taskId: string,
  narrowed: { task_id: string | null; state: number | null; progress: number | null; stage: string | null; error: string | null; postUrl: string | null },
): TaskWaitResult {
  const outcome = narrowed.state === 1 ? 'completed' : narrowed.state === -1 ? 'failed' : 'running';
  return attachPollHint({
    task_id: narrowed.task_id ?? taskId,
    state: narrowed.state,
    outcome,
    progress: narrowed.progress,
    stage: narrowed.stage,
    error: narrowed.error,
    postUrl: narrowed.postUrl,
  });
}

type PollOutcome =
  | { taskId: string; result: TaskWaitResult }
  | { taskId: string; callError: ApiError }
  | null;

export async function handleWaitForVideoTasks(
  client: PostEngineerClient,
  args: z.infer<typeof WaitForVideoTasksSchema>,
  deps: WaitForVideoTasksDeps = {},
): Promise<McpToolResponse> {
  const taskIds = [...new Set(args.taskIds)];
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = now() + args.waitSeconds * 1000;
  const last = new Map<string, TaskWaitResult>();

  const summarize = (results: TaskWaitResult[], timedOut: boolean): string => {
    const completed = results.filter((entry) => entry.outcome === 'completed').length;
    const failed = results.filter((entry) => entry.outcome === 'failed').length;
    const running = results.length - completed - failed;
    const counts = `${completed} completed, ${failed} failed, ${running} running`;
    if (args.waitSeconds === 0) return `Status now: ${counts}.`;
    return timedOut ? `Timed out after ${args.waitSeconds}s: ${counts}.` : `Wait finished: ${counts}.`;
  };

  for (;;) {
    const unfinished = taskIds.filter((taskId) => {
      const known = last.get(taskId);
      return known === undefined || known.outcome === 'running';
    });
    const settled = await Promise.allSettled(
      unfinished.map(async (taskId): Promise<PollOutcome> => {
        try {
          return { taskId, result: toWaitResult(taskId, narrowTaskProgress(await client.getVideoStatus(taskId))) };
        } catch (error) {
          if (error instanceof ApiError && error.status === 410) {
            if (error.delivered) {
              return {
                taskId,
                result: {
                  task_id: taskId,
                  state: 1,
                  outcome: 'completed',
                  progress: 100,
                  stage: null,
                  error: null,
                  postUrl: error.postUrl ?? null,
                } satisfies TaskWaitResult,
              };
            }
            return {
              taskId,
              result: {
                task_id: taskId,
                state: -1,
                outcome: 'failed',
                progress: null,
                stage: null,
                error: ENGINE_TASK_GONE_MESSAGE,
                postUrl: error.postUrl ?? null,
              } satisfies TaskWaitResult,
            };
          }
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 405)
          ) {
            return { taskId, callError: error };
          }
          if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
            return {
              taskId,
              result: {
                task_id: taskId,
                state: -1,
                outcome: 'failed',
                progress: null,
                stage: null,
                error: getErrorMessage(error),
                postUrl: null,
              } satisfies TaskWaitResult,
            };
          }
          return null;
        }
      }),
    );
    let callError: ApiError | null = null;
    for (const entry of settled) {
      if (entry.status !== 'fulfilled' || entry.value === null) continue;
      const value = entry.value;
      if ('callError' in value) {
        if (callError === null) callError = value.callError;
      } else {
        last.set(value.taskId, value.result);
      }
    }
    if (callError !== null) {
      const fatal = callError;
      return handleLibraryCall(
        async () => {
          throw fatal;
        },
        'waiting for video tasks',
      );
    }
    const results = taskIds.map(
      (taskId): TaskWaitResult =>
        last.get(taskId) ??
        attachPollHint({
          task_id: taskId,
          state: null,
          outcome: 'running',
          progress: null,
          stage: null,
          error: null,
          postUrl: null,
        }),
    );
    const allTerminal = results.every((entry) => entry.outcome !== 'running');
    if (allTerminal) {
      return handleLibraryCall(
        async () => ({ summary: summarize(results, false), allTerminal: true, timedOut: false, results }),
        'waiting for video tasks',
      );
    }
    if (now() >= deadline) {
      return handleLibraryCall(
        async () => ({ summary: summarize(results, true), allTerminal: false, timedOut: true, results }),
        'waiting for video tasks',
      );
    }
    await sleep(Math.min(pollIntervalMs, deadline - now()));
  }
}
