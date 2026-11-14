import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../errors.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';
import { WaitForVideoTasksSchema, handleWaitForVideoTasks } from '../video-task-tools.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function parsed(response: McpToolResponse): {
  summary: string;
  allTerminal: boolean;
  timedOut: boolean;
  results: Array<{
    task_id: string | null;
    state: number | null;
    outcome: 'completed' | 'failed' | 'running';
    progress: number | null;
    stage: string | null;
    error: string | null;
    postUrl: string | null;
  }>;
} {
  return JSON.parse(textOf(response)) as ReturnType<typeof parsed>;
}

function statusBody(
  taskId: string,
  state: number,
  progress: number,
  stage: string | null,
  error?: string,
  postUrl?: string,
): unknown {
  return {
    status: 200,
    message: 'success',
    body: {
      task_id: taskId,
      state,
      progress,
      stage,
      ...(error !== undefined ? { error } : {}),
      ...(postUrl !== undefined ? { postUrl } : {}),
    },
  };
}

/** Deterministic clock: sleep advances fake time instead of waiting. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('wait_for_video_tasks', () => {
  const mockClient = {
    getVideoStatus: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns completed on the first poll without sleeping', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue(
      statusBody('task-1', 1, 100, null, undefined, 'https://post-engineer.com/posts/slot-1'),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    expect(response.isError).toBeUndefined();
    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results).toEqual([
      { task_id: 'task-1', state: 1, outcome: 'completed', progress: 100, stage: null, error: null, postUrl: 'https://post-engineer.com/posts/slot-1' },
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('polls again after the interval while the task is still running', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus)
      .mockResolvedValueOnce(statusBody('task-1', 4, 30, 'audio'))
      .mockResolvedValueOnce(statusBody('task-1', 1, 100, null));

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.results[0]?.outcome).toBe('completed');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('surfaces the engine error when the task fails', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue(
      statusBody('task-1', -1, 75, 'render', 'persona hook must end between 3 and 6 seconds, got 6.55'),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: -1,
      outcome: 'failed',
      progress: 75,
      stage: 'render',
      error: 'persona hook must end between 3 and 6 seconds, got 6.55',
      postUrl: null,
    });
  });

  it('times out with partial results and keeps the last known progress', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue(statusBody('task-1', 4, 42, 'audio'));

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 10 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.summary).toContain('Timed out after 10s');
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: 4,
      outcome: 'running',
      progress: 42,
      stage: 'audio',
      error: null,
      postUrl: null,
    });
  });

  it('treats a 410 (engine lost the task, not delivered) as a terminal failure', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError(
        'Failed to get video status: 410 The video task no longer exists on the generation engine.',
        null,
        null,
        410,
      ),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: -1,
      outcome: 'failed',
      progress: null,
      stage: null,
      error: 'The video task no longer exists on the generation engine.',
      postUrl: null,
    });
  });

  it('treats a delivered 410 (video finished before the engine lost it) as completed', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError(
        'Failed to get video status: 410 The video task no longer exists on the generation engine.',
        null,
        null,
        410,
        true,
        'https://post-engineer.com/posts/slot-1',
      ),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: 1,
      outcome: 'completed',
      progress: 100,
      stage: null,
      error: null,
      postUrl: 'https://post-engineer.com/posts/slot-1',
    });
  });

  it('fails the task at once on a deterministic 4xx instead of retrying until the timeout', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError('Failed to get video status: 400 Invalid taskId.', null, null, 400),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: -1,
      outcome: 'failed',
      progress: null,
      stage: null,
      error: 'Failed to get video status: 400 Invalid taskId.',
      postUrl: null,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(vi.mocked(mockClient.getVideoStatus)).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 405])(
    'returns a tool error at once on a call-wide %i instead of failing the video',
    async (status) => {
      const clock = fakeClock();
      const sleep = vi.fn(clock.sleep);
      vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
        new ApiError(`Failed to get video status: ${status} call-wide error.`, null, null, status),
      );

      const response = await handleWaitForVideoTasks(
        mockClient,
        WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
        { now: clock.now, sleep },
      );

      // A revoked key or a wrong route is broken for every taskId: the
      // video itself may be fine, so this must never read as a failed
      // render (the agent would regenerate a video that was never broken).
      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain(
        `Error waiting for video tasks: Failed to get video status: ${status}`,
      );
      expect(sleep).not.toHaveBeenCalled();
      expect(vi.mocked(mockClient.getVideoStatus)).toHaveBeenCalledTimes(1);
    },
  );

  it('fails the task at once on a task-scoped 422 instead of retrying until the timeout', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError('Failed to get video status: 422 Unprocessable Entity.', null, null, 422),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.results[0]).toEqual({
      task_id: 'task-1',
      state: -1,
      outcome: 'failed',
      progress: null,
      stage: null,
      error: 'Failed to get video status: 422 Unprocessable Entity.',
      postUrl: null,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(vi.mocked(mockClient.getVideoStatus)).toHaveBeenCalledTimes(1);
  });

  it('retries a 408 instead of failing the task', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus)
      .mockRejectedValueOnce(
        new ApiError('Failed to get video status: 408 Request Timeout.', null, null, 408),
      )
      // Persistent (not once): the pre-fix code fails the task on the 408
      // and never polls again, which would leave a queued once-value
      // behind to pollute the next test.
      .mockResolvedValue(statusBody('task-1', 1, 100, null));

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.results[0]?.outcome).toBe('completed');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient fetch failure instead of failing the wait', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(statusBody('task-1', 1, 100, null));

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.results[0]?.outcome).toBe('completed');
  });

  it('dedupes repeated taskIds and keeps results in input order', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockImplementation((taskId: string) =>
      Promise.resolve(statusBody(taskId, 1, 100, null)),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1', 'task-1', 'task-2'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.results.map((entry) => entry.task_id)).toEqual(['task-1', 'task-2']);
    expect(vi.mocked(mockClient.getVideoStatus).mock.calls.map((call) => call[0])).toEqual([
      'task-1',
      'task-2',
    ]);
  });

  it('reports mixed outcomes per task', async () => {
    const clock = fakeClock();
    vi.mocked(mockClient.getVideoStatus).mockImplementation((taskId: string) =>
      Promise.resolve(
        taskId === 'task-1'
          ? statusBody('task-1', 1, 100, null)
          : statusBody('task-2', -1, 60, 'render', 'render failed'),
      ),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1', 'task-2'], waitSeconds: 120 }),
      { now: clock.now, sleep: clock.sleep },
    );

    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.summary).toContain('1 completed, 1 failed, 0 running');
    expect(result.results.map((entry) => entry.outcome)).toEqual(['completed', 'failed']);
  });

  it('validates taskIds and waitSeconds bounds', () => {
    expect(() => WaitForVideoTasksSchema.parse({ taskIds: [], waitSeconds: 120 })).toThrow();
    expect(() =>
      WaitForVideoTasksSchema.parse({ taskIds: Array.from({ length: 13 }, (_, i) => `task-${i}`) }),
    ).toThrow();
    expect(() => WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: -1 })).toThrow();
    expect(() =>
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 601 }),
    ).toThrow();
    expect(WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }).waitSeconds).toBe(120);
    expect(WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 600 }).waitSeconds).toBe(600);
  });

  it('defaults to a snapshot: waitSeconds 0 polls every task once and never sleeps', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue(statusBody('task-1', 4, 30, 'audio'));
    const args = WaitForVideoTasksSchema.parse({ taskIds: ['task-1', 'task-2'] });
    expect(args.waitSeconds).toBe(0);

    const response = await handleWaitForVideoTasks(mockClient, args, { now: clock.now, sleep });

    const result = parsed(response);
    expect(mockClient.getVideoStatus).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.allTerminal).toBe(false);
    expect(result.summary).toBe('Status now: 0 completed, 0 failed, 2 running.');
    expect(result.results.map((entry) => entry.outcome)).toEqual(['running', 'running']);
  });
});
