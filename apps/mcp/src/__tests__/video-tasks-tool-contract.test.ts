import { describe, expect, it } from 'vitest';
import { CancelVideoTaskSchema } from '../video-task-tools.js';
import { ListVideoGenerationsSchema } from '../tools.js';
import {
  GetVideoStatusResponseSchema,
  parseGenerationsLimit,
} from '../contracts/video-tasks.js';

//---------------
// video-tasks tool↔contract equivalence (shared/contracts/video-tasks.ts):
// the tool schemas and the contract schemas/parsers must accept and
// reject the same inputs, so a call the tool allows is one the route
// accepts and a call the route rejects fails fast in the tool.
//
// Deliberate differences, pinned here so they stay deliberate:
// - The generations limit is fail-fast in the tool (out-of-range never
//   leaves the MCP) but lenient on the route: an invalid limit falls back
//   to the default and an over-max limit clamps to 200 instead of 400ing.
// - The cancel tool accepts any non-empty taskId; the route 400s ids
//   outside SAFE_TASK_ID (lib/video-urls.ts) — spaces, slashes and other
//   non-task characters. The tool never validates the id shape, so a bad
//   id fails at the route, not in the tool.
// - The video-status body has no tool zod schema: narrowTaskProgress is
//   a runtime narrowing, so only the contract side is pinned here — the
//   envelope shapes the wait tool's tests feed it must parse.
//---------------

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
