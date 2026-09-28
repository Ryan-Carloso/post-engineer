import { describe, expect, it } from 'vitest';

import {
  parseSseSnapshot,
  isTerminalSnapshot,
} from '../video-task-events';

describe('parseSseSnapshot', () => {
  it('parses a data line into a snapshot', () => {
    const snapshot = parseSseSnapshot(
      'data: {"task_id":"t-1","state":4,"progress":30,"stage":"materials"}',
    );
    expect(snapshot).toEqual({
      taskId: 't-1',
      state: 4,
      progress: 30,
      stage: 'materials',
    });
  });

  it('allows a null stage', () => {
    const snapshot = parseSseSnapshot(
      'data: {"task_id":"t-1","state":3,"progress":0,"stage":null}',
    );
    expect(snapshot?.stage).toBeNull();
  });

  it('returns null for heartbeat comments', () => {
    expect(parseSseSnapshot(':heartbeat')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseSnapshot('data: not-json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseSseSnapshot('data: {"task_id":"t-1"}')).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseSseSnapshot('data: [1,2,3]')).toBeNull();
  });
});

describe('isTerminalSnapshot', () => {
  it('treats complete and failed as terminal', () => {
    expect(isTerminalSnapshot({ taskId: 't', state: 1, progress: 100, stage: null })).toBe(true);
    expect(isTerminalSnapshot({ taskId: 't', state: -1, progress: 50, stage: 'audio' })).toBe(true);
  });

  it('treats processing states as non-terminal', () => {
    expect(isTerminalSnapshot({ taskId: 't', state: 4, progress: 30, stage: null })).toBe(false);
    expect(isTerminalSnapshot({ taskId: 't', state: 3, progress: 0, stage: null })).toBe(false);
  });
});
