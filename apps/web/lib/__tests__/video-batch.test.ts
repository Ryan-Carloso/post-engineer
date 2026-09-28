import { describe, it, expect } from 'vitest';
import {
  MAX_BATCH_TOPICS,
  allBatchVideosTerminal,
  batchVideosReducer,
  initBatchVideos,
  parseBatchTopicsText,
  type BatchVideo,
} from '../video-batch';

describe('parseBatchTopicsText', () => {
  it('parses one topic per line, trimming and dropping empties', () => {
    expect(parseBatchTopicsText('  one  \n\ntwo\n   \nthree ')).toEqual({
      ok: true,
      topics: ['one', 'two', 'three'],
    });
  });

  it('accepts a single topic (a batch of 1)', () => {
    expect(parseBatchTopicsText('solo')).toEqual({ ok: true, topics: ['solo'] });
  });

  it('rejects empty input', () => {
    const result = parseBatchTopicsText('   \n  \n');
    expect(result.ok).toBe(false);
  });

  it(`rejects more than ${MAX_BATCH_TOPICS} topics`, () => {
    const text = Array.from({ length: MAX_BATCH_TOPICS + 1 }, (_, i) => `topic ${i}`).join('\n');
    expect(parseBatchTopicsText(text)).toEqual({
      ok: false,
      error: `A batch holds at most ${MAX_BATCH_TOPICS} videos.`,
    });
  });

  it('rejects topics longer than 300 chars', () => {
    const result = parseBatchTopicsText('x'.repeat(301));
    expect(result).toEqual({ ok: false, error: 'Each topic must be at most 300 characters.' });
  });
});

const queued = (taskId: string, topic: string): BatchVideo => ({
  taskId,
  topic,
  progress: 0,
  stage: null,
  status: 'queued',
});

describe('initBatchVideos', () => {
  it('creates one queued entry per task id, in order', () => {
    expect(initBatchVideos(['t1', 't2'], ['one', 'two'])).toEqual([queued('t1', 'one'), queued('t2', 'two')]);
  });
});

describe('batchVideosReducer', () => {
  it('advances only the snapshotted video (multiple streams stay independent)', () => {
    const videos = initBatchVideos(['t1', 't2'], ['one', 'two']);
    const next = batchVideosReducer(videos, {
      type: 'snapshot',
      taskId: 't1',
      progress: 0.6,
      stage: 'render',
      terminal: false,
    });
    expect(next[0]).toMatchObject({ status: 'generating', progress: 0.6, stage: 'render' });
    expect(next[1]).toMatchObject({ status: 'queued', progress: 0 });
  });

  it('marks a video done on terminal with its download URL', () => {
    const videos = initBatchVideos(['t1'], ['one']);
    const next = batchVideosReducer(videos, {
      type: 'terminal',
      taskId: 't1',
      outcome: 'done',
      downloadUrl: '/dl/t1.mp4',
    });
    expect(next[0]).toMatchObject({ status: 'done', progress: 1, downloadUrl: '/dl/t1.mp4' });
  });

  it('marks a video failed without touching its siblings', () => {
    const videos = initBatchVideos(['t1', 't2'], ['one', 'two']);
    const generating = batchVideosReducer(videos, {
      type: 'snapshot',
      taskId: 't1',
      progress: 0.5,
      stage: null,
      terminal: false,
    });
    const next = batchVideosReducer(generating, {
      type: 'terminal',
      taskId: 't2',
      outcome: 'failed',
      error: 'boom',
    });
    expect(next[0]).toMatchObject({ status: 'generating', progress: 0.5 });
    expect(next[1]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('marks a disconnected stream failed only while it is still active', () => {
    const videos = initBatchVideos(['t1', 't2'], ['one', 'two']);
    const done = batchVideosReducer(videos, { type: 'terminal', taskId: 't1', outcome: 'done' });
    const next = batchVideosReducer(done, { type: 'stream-error', taskId: 't1' });
    // Already terminal: the late error must not overwrite the outcome.
    expect(next[0]?.status).toBe('done');
    const next2 = batchVideosReducer(next, { type: 'stream-error', taskId: 't2' });
    expect(next2[1]).toMatchObject({ status: 'failed', error: 'Video progress stream disconnected.' });
  });

  it('ignores snapshots for unknown task ids', () => {
    const videos = initBatchVideos(['t1'], ['one']);
    const next = batchVideosReducer(videos, {
      type: 'snapshot',
      taskId: 'nope',
      progress: 0.9,
      stage: null,
      terminal: false,
    });
    expect(next).toEqual(videos);
  });
});

describe('allBatchVideosTerminal', () => {
  it('is true only when every video is done or failed', () => {
    expect(allBatchVideosTerminal([])).toBe(false);
    expect(allBatchVideosTerminal(initBatchVideos(['t1'], ['one']))).toBe(false);
    const done = batchVideosReducer(initBatchVideos(['t1', 't2'], ['one', 'two']), {
      type: 'terminal',
      taskId: 't1',
      outcome: 'done',
    });
    expect(allBatchVideosTerminal(done)).toBe(false);
    const failed = batchVideosReducer(done, { type: 'terminal', taskId: 't2', outcome: 'failed' });
    expect(allBatchVideosTerminal(failed)).toBe(true);
  });
});
