import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { cancelVideoTask } from './client-video-task.js';
import { ApiError, getErrorMessage } from './errors.js';
import { MAX_BATCH_VIDEOS } from './limits.js';
import { narrowTaskProgress } from './tools.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// cancel_video_task — MCP tool over DELETE /api/persona/video-task/[taskId].
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet.
//---------------

export const CancelVideoTaskShape = {
  taskId: z
    .string()
    .min(1, 'taskId is required')
    .describe(
      'Engine task id of the video to cancel (taskId from get_video_status, get_video_task_progress, get_post or list_posts). Only your own task can be cancelled.',
    ),
};

export const CancelVideoTaskSchema = z.object(CancelVideoTaskShape);

export async function handleCancelVideoTask(
  client: PostEngineerClient,
  args: z.infer<typeof CancelVideoTaskSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => cancelVideoTask(client, args.taskId), 'cancelling video task');
}

//---------------
// wait_for_video_tasks — block until every listed video task finishes.
//
// The agent alternative to polling get_video_task_progress: one call waits
// for all taskIds (a single video, or every video of a batch) and only
// returns when each is completed (state 1, or a 410 whose body says the
// video was delivered before the engine lost it) or failed (state -1, gone
// from the engine without delivery proof, or a task-scoped client error
// such as a bad taskId), or when timeoutSeconds elapses. A call-wide error
// (bad key, wrong route) aborts the whole wait as a tool error instead of
// failing any video. On timeout the results are partial — the still-running
// entries keep their last known progress/stage — so the agent calls again
// with the unfinished taskIds instead of polling from scratch.
//---------------

export const WaitForVideoTasksShape = {
  taskIds: z
    .array(z.string().min(1, 'taskId is required'))
    .min(1, 'Provide at least one taskId')
    .max(MAX_BATCH_VIDEOS, `At most ${MAX_BATCH_VIDEOS} taskIds per call`)
    .describe(
      'Engine task IDs from generate_persona_video or generate_persona_video_batch, one per video.',
    ),
  timeoutSeconds: z
    .number()
    .int()
    .min(10, 'timeoutSeconds must be at least 10')
    .max(600, 'timeoutSeconds must be at most 600')
    .default(120)
    .describe('Longest to wait for all tasks to finish, in seconds. Defaults to 120.'),
};

export const WaitForVideoTasksSchema = z.object(WaitForVideoTasksShape);

/** One task's wait outcome: completed/failed are terminal, running is not. */
export interface TaskWaitResult {
  task_id: string | null;
  state: number | null;
  outcome: 'completed' | 'failed' | 'running';
  progress: number | null;
  stage: string | null;
  error: string | null;
}

/** Clock and sleep injection (options, never test-only fields on the input). */
export interface WaitForVideoTasksDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
}

const POLL_INTERVAL_MS = 10_000;

// Same message the web video-status route answers with on 410 Gone.
const ENGINE_TASK_GONE_MESSAGE = 'The video task no longer exists on the generation engine.';

function toWaitResult(
  taskId: string,
  narrowed: { task_id: string | null; state: number | null; progress: number | null; stage: string | null; error: string | null },
): TaskWaitResult {
  const outcome = narrowed.state === 1 ? 'completed' : narrowed.state === -1 ? 'failed' : 'running';
  return {
    task_id: narrowed.task_id ?? taskId,
    state: narrowed.state,
    outcome,
    progress: narrowed.progress,
    stage: narrowed.stage,
    error: narrowed.error,
  };
}

/** One poll round's outcome per task: a verdict, a call-wide error, or retry-later. */
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
  const deadline = now() + args.timeoutSeconds * 1000;
  const last = new Map<string, TaskWaitResult>();

  const summarize = (results: TaskWaitResult[], timedOut: boolean): string => {
    const completed = results.filter((entry) => entry.outcome === 'completed').length;
    const failed = results.filter((entry) => entry.outcome === 'failed').length;
    const running = results.length - completed - failed;
    const counts = `${completed} completed, ${failed} failed, ${running} running`;
    return timedOut ? `Timed out after ${args.timeoutSeconds}s: ${counts}.` : `Wait finished: ${counts}.`;
  };

  for (;;) {
    const unfinished = taskIds.filter((taskId) => {
      const known = last.get(taskId);
      return known === undefined || known.outcome === 'running';
    });
    // One round polls every unfinished task concurrently: a slow engine
    // response for one video must not stall the other eleven behind it.
    const settled = await Promise.allSettled(
      unfinished.map(async (taskId): Promise<PollOutcome> => {
        try {
          return { taskId, result: toWaitResult(taskId, narrowTaskProgress(await client.getVideoStatus(taskId))) };
        } catch (error) {
          if (error instanceof ApiError && error.status === 410) {
            if (error.delivered) {
              // The video finished (durable COMPLETE render, or a published
              // slot) before the engine lost the task: the web route already
              // recorded it completed and never refunded — report completed,
              // not failed, so the agent never regenerates a published video.
              return {
                taskId,
                result: {
                  task_id: taskId,
                  state: 1,
                  outcome: 'completed',
                  progress: 100,
                  stage: null,
                  error: null,
                } satisfies TaskWaitResult,
              };
            }
            // The engine lost the task (restart with the in-memory state
            // backend) and nothing proves the video finished: the web route
            // already recorded the terminal failed verdict (refunding direct
            // generations; batch charges are left to the billing reconcile
            // cron), so this is terminal — waiting longer can never complete it.
            return {
              taskId,
              result: {
                task_id: taskId,
                state: -1,
                outcome: 'failed',
                progress: null,
                stage: null,
                error: ENGINE_TASK_GONE_MESSAGE,
              } satisfies TaskWaitResult,
            };
          }
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 405)
          ) {
            // Call-wide: the key, route or method is wrong for every
            // taskId, so this says nothing about the video itself. Report
            // it as a tool error, never as a failed render — a revoked key
            // must not make the agent regenerate a video that was never broken.
            return { taskId, callError: error };
          }
          if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
            // Task-scoped client error (bad taskId): retrying can never
            // succeed — fail this task now with the capped detail.
            return {
              taskId,
              result: {
                task_id: taskId,
                state: -1,
                outcome: 'failed',
                progress: null,
                stage: null,
                error: getErrorMessage(error),
              } satisfies TaskWaitResult,
            };
          }
          // Anything else (network errors, 5xx, 429, 408/425) is transient:
          // keep the last known state and retry next round instead of
          // failing the whole wait.
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
        last.get(taskId) ?? {
          task_id: taskId,
          state: null,
          outcome: 'running',
          progress: null,
          stage: null,
          error: null,
        },
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
