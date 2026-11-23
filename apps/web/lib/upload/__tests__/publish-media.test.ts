// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import {
  cleanupPublishMedia,
  PUBLISH_MEDIA_BUCKET,
  PUBLISH_MEDIA_MAX_AGE_MS,
  PUBLISH_MEDIA_URL_TTL_SECONDS,
  presignPublishMedia,
  uploadPublishMedia,
  type PublishMediaDeps,
} from '@/lib/upload/publish-media';
import { logger } from '@/lib/logger';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const BUCKET_URL = 'https://acct123.r2.cloudflarestorage.com/videos';
const NOW = Date.parse('2026-11-15T12:00:00.000Z');

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  contentLength: string | null;
}

function fakeFetch(respond: (call: Call) => Response): { deps: PublishMediaDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    if (!(input instanceof Request)) throw new Error('expected a signed Request');
    const call = {
      method: input.method,
      url: input.url,
      authorization: input.headers.get('authorization'),
      contentType: input.headers.get('content-type'),
      contentLength: input.headers.get('content-length'),
    };
    calls.push(call);
    return respond(call);
  });
  return { deps: { fetch: fetchImpl, now: () => NOW }, calls };
}

function listing(objects: Array<{ key: string; lastModified: string }>): string {
  const contents = objects
    .map((o) => `<Contents><Key>${o.key}</Key><LastModified>${o.lastModified}</LastModified><Size>1</Size></Contents>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>videos</Name>${contents}</ListBucketResult>`;
}

beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'acct123');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'AKIDEXAMPLE');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret-example');
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('uploadPublishMedia', () => {
  it('PUTs the bytes under publish-media/ and returns a presigned GET URL with a 1h expiry', async () => {
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    const url = await uploadPublishMedia(Buffer.from('video'), 'instagram/1794650460355_3c764afd.mp4', 'video/mp4', deps);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(`${BUCKET_URL}/publish-media/instagram/1794650460355_3c764afd.mp4`);
    expect(calls[0].contentType).toBe('video/mp4');
    expect(calls[0].authorization).toContain('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/');
    expect(calls[0].authorization).toContain('/auto/s3/aws4_request');

    const signed = new URL(url);
    expect(`${signed.origin}${signed.pathname}`).toBe(`${BUCKET_URL}/publish-media/instagram/1794650460355_3c764afd.mp4`);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe(String(PUBLISH_MEDIA_URL_TTL_SECONDS));
    expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain('secret-example');
  });

  it('sets Content-Length on the PUT: without it R2 answers 411', async () => {
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    await uploadPublishMedia(Buffer.from('video'), 'instagram/1794650460355_3c764afd.mp4', 'video/mp4', deps);

    expect(calls).toHaveLength(1);
    expect(calls[0].contentLength).toBe('5');
  });

  it('throws when R2 rejects the PUT, so the handler never hands the provider a dead URL', async () => {
    const { deps } = fakeFetch(() => new Response('denied', { status: 403 }));

    await expect(
      uploadPublishMedia(Buffer.from('v'), 'threads/1794650460355_3c764afd.mp4', 'video/mp4', deps),
    ).rejects.toThrow('Failed to upload media to R2: HTTP 403');
  });

  it('rejects a path that is not <provider>/<ms>_<8 hex>.<ext> before any request', async () => {
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    await expect(uploadPublishMedia(Buffer.from('v'), '../final-1.mp4', 'video/mp4', deps)).rejects.toThrow(
      'Invalid publish media path',
    );
    expect(calls).toHaveLength(0);
  });

  it('names every missing R2 variable and makes no request', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', '');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', undefined);
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    await expect(
      uploadPublishMedia(Buffer.from('v'), 'facebook/1794650460355_3c764afd.mp4', 'video/mp4', deps),
    ).rejects.toThrow('R2 publish media storage is not configured; missing R2_ACCOUNT_ID, R2_SECRET_ACCESS_KEY');
    expect(calls).toHaveLength(0);
  });
});

describe('presignPublishMedia', () => {
  it('signs the engine archive key directly with a 1h expiry and no publish-media prefix', async () => {
    const url = await presignPublishMedia('user-1/voiceover/task-7/final-1.mp4');
    const signed = new URL(url);
    expect(`${signed.origin}${signed.pathname}`).toBe(`${BUCKET_URL}/user-1/voiceover/task-7/final-1.mp4`);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe(String(PUBLISH_MEDIA_URL_TTL_SECONDS));
    expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain('publish-media');
    expect(url).not.toContain('secret-example');
  });

  it.each([
    ['temp copy key', 'publish-media/instagram/1794650460355_3c764afd.mp4'],
    ['traversal', '../final-1.mp4'],
    ['wrong leaf', 'user-1/voiceover/task-7/other.mp4'],
    ['too few segments', 'user-1/final-1.mp4'],
    ['leading slash', '/user-1/voiceover/task-7/final-1.mp4'],
  ])('rejects %s before any request', async (_name, key) => {
    await expect(presignPublishMedia(key)).rejects.toThrow('Invalid video storage path');
  });

  it('names every missing R2 variable', async () => {
    vi.stubEnv('R2_ACCESS_KEY_ID', undefined);
    await expect(presignPublishMedia('user-1/voiceover/task-7/final-1.mp4')).rejects.toThrow(
      'R2 publish media storage is not configured; missing R2_ACCESS_KEY_ID',
    );
  });
});

describe('cleanupPublishMedia', () => {
  const old = new Date(NOW - PUBLISH_MEDIA_MAX_AGE_MS - 1000).toISOString();
  const fresh = new Date(NOW - 1000).toISOString();

  it('deletes only this provider’s media older than 24h with the exact key shape', async () => {
    const { deps, calls } = fakeFetch((call) =>
      call.method === 'GET'
        ? new Response(
          listing([
            { key: 'publish-media/threads/1794650460355_3c764afd.mp4', lastModified: old },
            { key: 'publish-media/threads/1794650522796_c93f92dd.mp4', lastModified: fresh },
            { key: 'publish-media/threads/notes.txt', lastModified: old },
            { key: 'publish-media/instagram/1794650460355_3c764afd.mp4', lastModified: old },
          ]),
          { status: 200 },
        )
        : new Response(null, { status: 204 }),
    );

    const removed = await cleanupPublishMedia('threads', deps);

    expect(removed).toBe(1);
    const list = new URL(calls[0].url);
    expect(calls[0].method).toBe('GET');
    expect(list.searchParams.get('list-type')).toBe('2');
    expect(list.searchParams.get('prefix')).toBe('publish-media/threads/');
    expect(calls.slice(1)).toEqual([
      expect.objectContaining({ method: 'DELETE', url: `${BUCKET_URL}/publish-media/threads/1794650460355_3c764afd.mp4` }),
    ]);
    expect(logger.info).toHaveBeenCalledWith('Publish media cleanup completed', {
      metadata: { provider: 'threads', removed: 1 },
    });
  });

  it('logs a failed list and deletes nothing', async () => {
    const { deps, calls } = fakeFetch(() => new Response('err', { status: 500 }));

    expect(await cleanupPublishMedia('instagram', deps)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('Publish media cleanup: failed to list objects', {
      metadata: { provider: 'instagram', status: 500 },
    });
  });

  it('logs a failed delete and keeps going with the next stale object', async () => {
    let deletes = 0;
    const { deps } = fakeFetch((call) => {
      if (call.method === 'GET') {
        return new Response(
          listing([
            { key: 'publish-media/facebook/1794650460355_3c764afd.mp4', lastModified: old },
            { key: 'publish-media/facebook/1794650460356_3c764afe.mp4', lastModified: old },
          ]),
          { status: 200 },
        );
      }
      deletes += 1;
      return new Response(null, { status: deletes === 1 ? 500 : 204 });
    });

    expect(await cleanupPublishMedia('facebook', deps)).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('Publish media cleanup: failed to delete object', {
      metadata: { provider: 'facebook', key: 'publish-media/facebook/1794650460355_3c764afd.mp4', status: 500 },
    });
  });

  it('never rejects: a missing R2 config is logged and returns 0', async () => {
    vi.stubEnv('R2_ACCESS_KEY_ID', undefined);
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    expect(await cleanupPublishMedia('threads', deps)).toBe(0);
    expect(calls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('Publish media cleanup: unexpected error', {
      metadata: { provider: 'threads', error: 'R2 publish media storage is not configured; missing R2_ACCESS_KEY_ID' },
    });
  });

  it('rejects a provider that would widen the prefix', async () => {
    const { deps, calls } = fakeFetch(() => new Response(null, { status: 200 }));

    expect(await cleanupPublishMedia('', deps)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('PUBLISH_MEDIA_BUCKET', () => {
  it('matches the engine R2 bucket literal', () => {
    const source = readFileSync(
      path.join(findRepoRoot(import.meta.url), 'apps/engine/app/services/video_storage.py'),
      'utf8',
    );
    expect(source.includes(`STORAGE_BUCKET = "${PUBLISH_MEDIA_BUCKET}"`)).toBe(true);
  });
});
