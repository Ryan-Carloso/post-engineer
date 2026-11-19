import { describe, expect, it } from 'vitest';
import { CancelVideoTaskSchema } from '../video-task-tools.js';
import { ListVideoGenerationsSchema } from '../tools.js';
import {
  GetVideoStatusResponseSchema,
  parseGenerationsLimit,
} from '../contracts/video-tasks.js';

describe('video-tasks tool-contract equivalence', () => {
  it('generations limit: tool fails fast where the route falls back or clamps', () => {
    const cases: Array<{ tool: unknown; route: string | null; toolOk: boolean; routeValue: number }> = [
      { tool: 0, route: '0', toolOk: false, routeValue: 50 },
      { tool: 1, route: '1', toolOk: true, routeValue: 1 },
      { tool: 200, route: '200', toolOk: true, routeValue: 200 },
      { tool: 201, route: '201', toolOk: false, routeValue: 200 },
      { tool: 1.5, route: '1.5', toolOk: false, routeValue: 50 },
    ];
    for (const { tool, route, toolOk, routeValue } of cases) {
      expect(ListVideoGenerationsSchema.safeParse({ limit: tool }).success).toBe(toolOk);
      expect(parseGenerationsLimit(route)).toBe(routeValue);
    }
    expect(ListVideoGenerationsSchema.safeParse({}).success).toBe(true);
    expect(parseGenerationsLimit(null)).toBe(50);
    expect(parseGenerationsLimit('abc')).toBe(50);
  });

  it('cancel accepts any non-empty taskId in the tool', () => {
    expect(CancelVideoTaskSchema.safeParse({ taskId: 'task-1' }).success).toBe(true);
    expect(CancelVideoTaskSchema.safeParse({ taskId: 'task 1' }).success).toBe(true);
    expect(CancelVideoTaskSchema.safeParse({ taskId: 'a/b' }).success).toBe(true);
    expect(CancelVideoTaskSchema.safeParse({ taskId: '' }).success).toBe(false);
    expect(CancelVideoTaskSchema.safeParse({}).success).toBe(false);
  });

  it('status envelope parses the running, completed and failed bodies', () => {
    const running = {
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: 4, progress: 42, stage: 'audio' },
    };
    const completed = {
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: 1, progress: 100, stage: null, postUrl: 'https://post-engineer.com/posts/slot-1' },
    };
    const failed = {
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: -1, progress: 30, stage: 'render', error: 'persona hook must end between 3 and 6 seconds' },
    };
    expect(GetVideoStatusResponseSchema.safeParse(running).success).toBe(true);
    expect(GetVideoStatusResponseSchema.safeParse(completed).success).toBe(true);
    expect(GetVideoStatusResponseSchema.safeParse(failed).success).toBe(true);
  });

  it('status envelope rejects a body without the engine envelope', () => {
    expect(
      GetVideoStatusResponseSchema.safeParse({ success: true, status: 'completed', videoUrl: 'https://cdn.example.com/video.mp4' }).success,
    ).toBe(false);
    expect(
      GetVideoStatusResponseSchema.safeParse({ status: 200, message: 'success', body: { state: 1, progress: 100 } }).success,
    ).toBe(false);
  });
});
