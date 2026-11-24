import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { VideoTasksDescription } from '../intent-video.js';
import {
  PROGRESS_POLL_EARLY_SECONDS,
  PROGRESS_POLL_FLOOR_SECONDS,
  nextPollInSeconds,
} from '../progress-poll-hint.js';
import type { McpToolResponse } from '../tools-call.js';
import { WaitForVideoTasksSchema, WaitForVideoTasksShape, handleWaitForVideoTasks } from '../video-task-tools.js';

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

interface PollEntry {
  outcome: string;
  state: number | null;
  progress: number | null;
  nextPollInSeconds?: number;
}

function parsed(response: McpToolResponse): { results: PollEntry[] } {
  return JSON.parse(textOf(response)) as { results: PollEntry[] };
}

function statusBody(taskId: string, state: number, progress: number, stage: string | null) {
  return { status: 200, message: 'success', body: { task_id: taskId, state, progress, stage } };
}

describe('nextPollInSeconds', () => {
  it('is larger at the start of a render and never below the one-minute floor', () => {
    expect(PROGRESS_POLL_FLOOR_SECONDS).toBe(60);
    expect(PROGRESS_POLL_EARLY_SECONDS).toBe(120);
    expect(nextPollInSeconds(4, 0)).toBe(120);
    expect(nextPollInSeconds(3, null)).toBe(120);
    expect(nextPollInSeconds(4, 50)).toBe(90);
    expect(nextPollInSeconds(4, 42)).toBe(95);
    expect(nextPollInSeconds(4, 100)).toBe(60);
    expect(nextPollInSeconds(4, 0)).toBeGreaterThan(nextPollInSeconds(4, 80) ?? 0);
    expect(nextPollInSeconds(4, 150)).toBe(PROGRESS_POLL_FLOOR_SECONDS);
  });

  it('omits the hint for terminal states', () => {
    expect(nextPollInSeconds(1, 100)).toBeUndefined();
    expect(nextPollInSeconds(-1, 30)).toBeUndefined();
  });
});

describe('video_tasks status poll answer', () => {
  const mockClient = { getVideoStatus: vi.fn() } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes nextPollInSeconds on a snapshot and omits it when the task is terminal', async () => {
    vi.mocked(mockClient.getVideoStatus).mockImplementation(async (taskId: string) => {
      if (taskId === 'early') return statusBody('early', 4, 0, 'queued');
      if (taskId === 'late') return statusBody('late', 4, 80, 'render');
      if (taskId === 'done') return statusBody('done', 1, 100, null);
      return statusBody('failed', -1, 20, 'render');
    });

    const response = await handleWaitForVideoTasks(
      mockClient,
      WaitForVideoTasksSchema.parse({ taskIds: ['early', 'late', 'done', 'failed'], waitSeconds: 0 }),
    );
    const { results } = parsed(response);
    const early = results[0];
    const late = results[1];
    const done = results[2];
    const failed = results[3];
    expect(early?.nextPollInSeconds).toBe(120);
    expect(late?.nextPollInSeconds).toBe(nextPollInSeconds(4, 80));
    expect(early?.nextPollInSeconds).toBeGreaterThan(late?.nextPollInSeconds ?? 0);
    expect(late?.nextPollInSeconds).toBeGreaterThanOrEqual(PROGRESS_POLL_FLOOR_SECONDS);
    expect(Object.hasOwn(done ?? {}, 'nextPollInSeconds')).toBe(false);
    expect(Object.hasOwn(failed ?? {}, 'nextPollInSeconds')).toBe(false);
    expect(textOf(response)).toContain('"nextPollInSeconds": 120');
    expect(JSON.stringify(done)).not.toContain('nextPollInSeconds');
    expect(JSON.stringify(failed)).not.toContain('nextPollInSeconds');
  });
});

describe('video_tasks status description', () => {
  it('leads with the server-side wait and tells the agent to honor nextPollInSeconds', () => {
    const description = VideoTasksDescription;
    const waitAt = description.indexOf('waitSeconds');
    const snapshotAt = description.indexOf('snapshot');
    expect(description.startsWith('For the final outcome')).toBe(true);
    expect(waitAt).toBeGreaterThanOrEqual(0);
    expect(snapshotAt).toBeGreaterThan(waitAt);
    expect(description).toContain('nextPollInSeconds');
    expect(description).toContain('at most once a minute');

    const field = WaitForVideoTasksShape.waitSeconds.description ?? '';
    expect(field.indexOf('final outcome')).toBeGreaterThanOrEqual(0);
    expect(field.indexOf('final outcome')).toBeLessThan(field.indexOf('snapshot'));
    expect(field).toContain('nextPollInSeconds');
    expect(field).toContain('at most once a minute');
  });
});
