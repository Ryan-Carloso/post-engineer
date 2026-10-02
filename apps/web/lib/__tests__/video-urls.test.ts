// @vitest-environment node
import { describe, it, expect } from 'vitest';

//---------------
// rewriteVideoUrls unit tests.
// Extracted from the video-status route so the delete-preview endpoint can
// reuse the exact same engine-URI → web-download-URL mapping.
//---------------

import { firstDownloadUrl, rewriteVideoUrls, SAFE_TASK_ID } from '../video-urls';

const BASE = 'https://engine.internal:8080';
const TASK = 'task-abc-123';

describe('rewriteVideoUrls', () => {
  it('rewrites an engine download URI to the web download proxy', () => {
    expect(rewriteVideoUrls('/api/v1/download/task-abc-123/final.mp4', TASK, BASE)).toBe(
      '/api/persona/video-download/task-abc-123/final.mp4',
    );
  });

  it('rewrites a stream URI with the source=stream marker', () => {
    expect(rewriteVideoUrls('/api/v1/stream/task-abc-123/final.mp4', TASK, BASE)).toBe(
      '/api/persona/video-download/task-abc-123/final.mp4?source=stream',
    );
  });

  it('rewrites absolute engine URLs whose origin matches the engine base', () => {
    expect(
      rewriteVideoUrls('https://engine.internal:8080/api/v1/download/t/f.mp4', TASK, BASE),
    ).toBe('/api/persona/video-download/task-abc-123/t/f.mp4');
  });

  it('passes absolute URLs from a foreign origin through untouched (never proxied)', () => {
    // Only engine-origin /api/v1/download|stream URIs are rewritten to the
    // web proxy; foreign URLs are data, returned as-is and never fetched.
    expect(rewriteVideoUrls('https://evil.example/x.mp4', TASK, BASE)).toBe(
      'https://evil.example/x.mp4',
    );
  });

  it('nulls absolute engine-origin URLs that are not download/stream paths', () => {
    expect(rewriteVideoUrls('https://engine.internal:8080/api/v1/tasks/x', TASK, BASE)).toBeNull();
  });

  it('leaves non-URL strings untouched', () => {
    expect(rewriteVideoUrls('lipsync', TASK, BASE)).toBe('lipsync');
  });

  it('recurses into objects and arrays', () => {
    expect(
      rewriteVideoUrls({ video: '/api/v1/download/t/f.mp4', tags: ['a'] }, TASK, BASE),
    ).toEqual({
      video: '/api/persona/video-download/task-abc-123/t/f.mp4',
      tags: ['a'],
    });
  });

  it('returns the body unchanged when the path is empty after the taskId shift', () => {
    const body = '/api/v1/download/task-abc-123';
    expect(rewriteVideoUrls(body, TASK, BASE)).toBe(body);
  });
});

describe('firstDownloadUrl', () => {
  it('returns the first rewritten download URL, skipping stream URLs', () => {
    expect(
      firstDownloadUrl({
        stream: '/api/persona/video-download/task-abc-123/f.mp4?source=stream',
        video: '/api/persona/video-download/task-abc-123/final.mp4',
      }),
    ).toBe('/api/persona/video-download/task-abc-123/final.mp4');
  });

  it('returns null when there is no downloadable file', () => {
    expect(firstDownloadUrl({ state: 'failed', progress: 0 })).toBeNull();
    expect(firstDownloadUrl(null)).toBeNull();
  });

  it('rejects pre-formed URLs with an unsafe task-id segment', () => {
    // Path traversal smuggled into a same-origin download href.
    expect(
      firstDownloadUrl({ video: '/api/persona/video-download/../../settings' }),
    ).toBeNull();
    expect(
      firstDownloadUrl({ video: '/api/persona/video-download/%2e%2e/x' }),
    ).toBeNull();
  });
});

describe('SAFE_TASK_ID', () => {
  it('accepts engine-generated ids', () => {
    expect(SAFE_TASK_ID.test('82024119-d80b-4759-83df-395ab044680a')).toBe(true);
    expect(SAFE_TASK_ID.test('task_abc.123-XYZ')).toBe(true);
  });

  it('rejects traversal and injection shapes', () => {
    expect(SAFE_TASK_ID.test('../../etc/passwd')).toBe(false);
    expect(SAFE_TASK_ID.test('task;rm -rf /')).toBe(false);
    expect(SAFE_TASK_ID.test('')).toBe(false);
    expect(SAFE_TASK_ID.test('-leading-dash')).toBe(false);
  });
});
