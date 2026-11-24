import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';
import { nextPollInSeconds } from '../progress-poll-hint.js';
import { POLL_INTERVAL_MS, WaitForVideoTasksSchema, handleWaitForVideoTasks } from '../video-task-tools.js';
import type { ResponseOf } from '../contracts/endpoint.js';
import { getVideoStatus } from '../contracts/video-tasks.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function parsed(response: McpToolResponse): {
  allTerminal: boolean;
  timedOut: boolean;
  results: Array<{ outcome: string; nextPollInSeconds?: number }>;
} {
  return JSON.parse(textOf(response)) as ReturnType<typeof parsed>;
}

function statusBody(taskId: string, state: number, progress: number, stage: string | null): ResponseOf<typeof getVideoStatus> {
  return { status: 200, message: 'success', body: { task_id: taskId, state, progress, stage } };
}

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('video_tasks status under the one-poll-per-minute limit', () => {
  const mockClient = { getVideoStatus: vi.fn() } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('polls a running task once a minute by default', () => {
    expect(POLL_INTERVAL_MS).toBe(60_000);
  });

  it('waits out the Retry-After of a 429 instead of failing the wait', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus)
      .mockRejectedValueOnce(
        new ApiError('Failed to get video status: 429 poll at most once per minute', null, null, 429, false, null, 95),
      )
      .mockResolvedValue(statusBody('task-1', 1, 100, null));

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 300 }),
      { now: clock.now, sleep },
    );

    expect(response.isError).toBeUndefined();
    const result = parsed(response);
    expect(result.allTerminal).toBe(true);
    expect(result.results[0]?.outcome).toBe('completed');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(95_000);
  });

  it('keeps the poll interval when the Retry-After is shorter', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus)
      .mockRejectedValueOnce(new ApiError('Failed to get video status: 429', null, null, 429, false, null, 5))
      .mockResolvedValue(statusBody('task-1', 1, 100, null));

    await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 300 }),
      { now: clock.now, sleep },
    );

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('never sleeps past the deadline for a long Retry-After', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError('Failed to get video status: 429', null, null, 429, false, null, 500),
    );

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 120 }),
      { now: clock.now, sleep },
    );

    expect(parsed(response).timedOut).toBe(true);
    expect(sleep).toHaveBeenCalledWith(120_000);
  });

  it('answers a rate-limited snapshot as running with nextPollInSeconds at least the Retry-After', async () => {
    vi.mocked(mockClient.getVideoStatus).mockImplementation(async (taskId: string) => {
      if (taskId === 'limited') {
        throw new ApiError('Failed to get video status: 429', null, null, 429, false, null, 200);
      }
      return statusBody(taskId, 4, 100, 'render');
    });

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['limited', 'free'] }),
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(textOf(response)) as { results: Array<{ outcome: string; nextPollInSeconds?: number }> };
    expect(result.results[0]).toMatchObject({ outcome: 'running', nextPollInSeconds: 200 });
    expect(result.results[1]).toMatchObject({ outcome: 'running', nextPollInSeconds: nextPollInSeconds(4, 100) });
  });

  it('keeps the progress hint when it is longer than the Retry-After', async () => {
    vi.mocked(mockClient.getVideoStatus).mockRejectedValue(
      new ApiError('Failed to get video status: 429', null, null, 429, false, null, 3),
    );

    const response = await handleWaitForVideoTasks(mockClient, WaitForVideoTasksSchema.parse({ taskIds: ['task-1'] }));

    const result = JSON.parse(textOf(response)) as { results: Array<{ nextPollInSeconds?: number }> };
    expect(result.results[0]?.nextPollInSeconds).toBe(nextPollInSeconds(null, null));
  });

  it('retries a 429 without Retry-After after the poll interval', async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    vi.mocked(mockClient.getVideoStatus)
      .mockRejectedValueOnce(new ApiError('Failed to get video status: 429', null, null, 429))
      .mockResolvedValue(statusBody('task-1', 1, 100, null));

    await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['task-1'], waitSeconds: 300 }),
      { now: clock.now, sleep },
    );

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(60_000);
  });
});
