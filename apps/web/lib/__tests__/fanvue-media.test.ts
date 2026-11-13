// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FANVUE_MAX_FILE_BYTES,
  FANVUE_MEDIA_READY_TIMEOUT_MS,
  FANVUE_UPLOAD_TIMEOUT_MS,
  completeFanvueUploadSession,
  createFanvueUploadSession,
  fetchFanvueMedia,
  fetchFanvueUploadPartUrls,
  uploadFanvueUploadPart,
  uploadVideoToFanvueVault,
  waitForFanvueMediaReady,
} from '@/lib/fanvue-media';
import { FANVUE_API_VERSION } from '@/lib/fanvue-http';
import { FanvueError } from '@/lib/errors';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(index: number): { url: URL; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), init };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function partUrl(partNumber: number): string {
  return `https://up.example/part-${partNumber}`;
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    mediaUuid: 'media-1',
    uploadId: 'sess-1',
    partSize: 4,
    maxParts: 10,
    totalParts: 3,
    ...overrides,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('createFanvueUploadSession', () => {
  it('registers a video through POST /media/uploads and reads the multipart session', async () => {
    mockFetch.mockResolvedValueOnce(sessionResponse());

    const session = await createFanvueUploadSession('at-1', { filename: 'clip.mp4', fileSize: 10 });
    expect(session).toEqual({
      mediaUuid: 'media-1',
      uploadId: 'sess-1',
      partSize: 4,
      maxParts: 10,
      totalParts: 3,
    });

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/media/uploads');
    expect(first.init.method).toBe('POST');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe(FANVUE_API_VERSION);
    expect(JSON.parse(String(first.init.body))).toEqual({
      name: 'clip.mp4',
      filename: 'clip.mp4',
      mediaType: 'video',
      sizeBytes: 10,
    });
  });

  it('keeps totalParts null when the API omitted it', async () => {
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: null }));
    const session = await createFanvueUploadSession('at-1', { filename: 'clip.mp4', fileSize: 10 });
    expect(session.totalParts).toBeNull();
  });

  it.each([
    ['mediaUuid', { mediaUuid: undefined }, 'missing mediaUuid'],
    ['uploadId', { uploadId: undefined }, 'missing uploadId'],
    ['partSize', { partSize: 0 }, 'invalid partSize'],
    ['maxParts', { maxParts: null }, 'invalid maxParts'],
  ])('rejects a session without a valid %s', async (_name, overrides, message) => {
    mockFetch.mockResolvedValueOnce(sessionResponse(overrides));
    await expect(
      createFanvueUploadSession('at-1', { filename: 'clip.mp4', fileSize: 10 }),
    ).rejects.toThrow(message);
  });
});

describe('fetchFanvueUploadPartUrls', () => {
  it('signs a contiguous range and sorts the parts by number', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        partSize: 4,
        parts: [
          { partNumber: 2, url: partUrl(2) },
          { partNumber: 1, url: partUrl(1) },
        ],
      }),
    );

    const parts = await fetchFanvueUploadPartUrls('at-1', 'sess-1', 1, 2);
    expect(parts).toEqual([
      { partNumber: 1, url: partUrl(1) },
      { partNumber: 2, url: partUrl(2) },
    ]);

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe(
      'https://api.fanvue.com/media/uploads/sess-1/parts/urls',
    );
    expect(first.url.searchParams.get('from')).toBe('1');
    expect(first.url.searchParams.get('to')).toBe('2');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
  });

  it('rejects an empty part list', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ parts: [] }));
    await expect(fetchFanvueUploadPartUrls('at-1', 'sess-1', 1, 1)).rejects.toThrow('missing part URLs');
  });

  it('drops malformed entries and rejects when nothing usable remains', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ parts: [{ partNumber: 'x', url: 1 }] }));
    await expect(fetchFanvueUploadPartUrls('at-1', 'sess-1', 1, 1)).rejects.toThrow('missing part URLs');
  });
});

describe('uploadFanvueUploadPart', () => {
  const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

  it('PUTs the bytes without a Bearer header and returns the etag', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { etag: '"etag-1"' } }),
    );
    const etag = await uploadFanvueUploadPart(partUrl(1), bytes, 'video/mp4');
    expect(etag).toBe('"etag-1"');
    const first = call(0);
    expect(first.url.href).toBe(partUrl(1));
    expect(first.init.method).toBe('PUT');
    expect(headersOf(first.init).Authorization).toBeUndefined();
    const body = first.init.body as Blob;
    expect(body.type).toBe('video/mp4');
    expect(await body.arrayBuffer()).toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  });

  it('throws when the presigned upload is rejected', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(uploadFanvueUploadPart(partUrl(1), bytes, 'video/mp4')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('throws when the response carries no etag', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(uploadFanvueUploadPart(partUrl(1), bytes, 'video/mp4')).rejects.toThrow('missing etag');
  });

  it('gives the byte upload a 10-minute budget, not the 15s JSON timeout', async () => {
    mockFetch.mockImplementationOnce((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
    );
    vi.useFakeTimers();
    try {
      const pending = uploadFanvueUploadPart(partUrl(1), bytes, 'video/mp4');
      const settled = vi.fn();
      pending.then(settled, settled);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(FANVUE_UPLOAD_TIMEOUT_MS - 15_000);
      await expect(pending).rejects.toThrow('aborted');
      expect(settled).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('completeFanvueUploadSession', () => {
  it('PATCHes the capitalized part fields and returns the processing status', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'processing' }));
    const status = await completeFanvueUploadSession('at-1', 'sess-1', [
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
    ]);
    expect(status).toBe('processing');

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/media/uploads/sess-1');
    expect(first.init.method).toBe('PATCH');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(JSON.parse(String(first.init.body))).toEqual({
      parts: [
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' },
      ],
    });
  });

  it('rejects a completion response without a status', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      completeFanvueUploadSession('at-1', 'sess-1', [{ partNumber: 1, etag: '"e"' }]),
    ).rejects.toThrow('missing status');
  });

  it('rejects an unknown media status instead of guessing', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'transcoding' }));
    await expect(
      completeFanvueUploadSession('at-1', 'sess-1', [{ partNumber: 1, etag: '"e"' }]),
    ).rejects.toThrow('unknown media status transcoding');
  });
});

describe('fetchFanvueMedia', () => {
  it('reads the media status and failure reason', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'error', errorReason: 'video_too_long' }));
    await expect(fetchFanvueMedia('at-1', 'media-1')).resolves.toEqual({
      status: 'error',
      errorReason: 'video_too_long',
    });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/media/media-1');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
  });

  it('rejects a missing status', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(fetchFanvueMedia('at-1', 'media-1')).rejects.toThrow('missing media status');
  });
});

describe('waitForFanvueMediaReady', () => {
  it('polls through processing and resolves on ready', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ready' }));
    const sleep = vi.fn(async () => undefined);
    await expect(waitForFanvueMediaReady('at-1', 'media-1', { sleep })).resolves.toEqual({
      status: 'ready',
      errorReason: null,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fails with the errorReason when processing failed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'error', errorReason: 'unsupported_format' }));
    await expect(
      waitForFanvueMediaReady('at-1', 'media-1', { sleep: async () => undefined }),
    ).rejects.toThrow('media processing failed (unsupported_format)');
  });

  it('caps the default ready wait at 120s to leave room for the upload inside the clients 600s budget', () => {
    // The engine (DEFAULT_TIMEOUT_SECONDS) and the MCP client
    // (DIRECT_PUBLISH_TIMEOUT_MS) both abort at 600s; the request also
    // uploads every part first, so a 300s poll would leave less room for
    // the upload before the clients abort and the scheduler retry
    // duplicates the post. The cap shrinks that window; it does not
    // eliminate it, since a slow upload alone can still exceed 600s.
    expect(FANVUE_MEDIA_READY_TIMEOUT_MS).toBe(2 * 60_000);
  });

  it('times out instead of waiting forever', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ status: 'processing' }));
    await expect(
      waitForFanvueMediaReady('at-1', 'media-1', { timeoutMs: 30, intervalMs: 5 }),
    ).rejects.toMatchObject({ statusCode: 504 });
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('uploadVideoToFanvueVault', () => {
  const video = Buffer.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73,
  ]);

  function queueSuccess(parts: number): void {
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: null }));
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        partSize: 4,
        parts: Array.from({ length: parts }, (_entry, index) => ({
          partNumber: index + 1,
          url: partUrl(index + 1),
        })),
      }),
    );
    for (let part = 1; part <= parts; part += 1) {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: `"e${part}"` } }));
    }
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'processing' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'ready' }));
  }

  it('uploads every part, completes the session, waits for ready and returns the media uuid', async () => {
    queueSuccess(3);

    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).resolves.toBe('media-1');

    expect(mockFetch).toHaveBeenCalledTimes(7);

    // Untyped totalParts: the caller computes ceil(10 / 4) = 3.
    const signed = call(1);
    expect(signed.url.searchParams.get('from')).toBe('1');
    expect(signed.url.searchParams.get('to')).toBe('3');

    expect((call(2).init.body as Blob).size).toBe(4);
    expect((call(3).init.body as Blob).size).toBe(4);
    expect((call(4).init.body as Blob).size).toBe(2);
    expect(call(2).url.href).toBe(partUrl(1));
    expect(call(4).url.href).toBe(partUrl(3));

    const complete = call(5);
    expect(complete.init.method).toBe('PATCH');
    expect(JSON.parse(String(complete.init.body))).toEqual({
      parts: [
        { PartNumber: 1, ETag: '"e1"' },
        { PartNumber: 2, ETag: '"e2"' },
        { PartNumber: 3, ETag: '"e3"' },
      ],
    });
    expect(`${call(6).url.pathname}`).toBe('/media/media-1');
  });

  it('rejects a session whose totalParts does not cover the whole file', async () => {
    // 10 bytes at a 4-byte partSize need 3 parts; an API totalParts of 2
    // would leave the last 2 bytes unsent and silently truncate the video.
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: 2 }));

    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('session covers 8 of 10 bytes');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a session whose totalParts exceeds the parts the file needs', async () => {
    // 10 bytes at a 4-byte partSize need 3 parts; an API totalParts of 4
    // would upload a zero-byte part past the end of the buffer.
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: 4 }));

    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('session allots 4 parts, file needs 3');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fails when the signed URLs skip a part it must upload', async () => {
    mockFetch
      .mockResolvedValueOnce(sessionResponse({ totalParts: 3 }))
      .mockResolvedValueOnce(
        jsonResponse({ partSize: 4, parts: [{ partNumber: 1, url: partUrl(1) }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"e1"' } }));

    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('missing signed URL for part 2');
  });

  it('fails before signing when the file needs more parts than the session allows', async () => {
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: 3, maxParts: 2 }));
    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('file needs 3 parts, session allows 2');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty video and an oversized video before any request', async () => {
    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video: Buffer.alloc(0),
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow('video is empty');

    const oversized = Buffer.alloc(FANVUE_MAX_FILE_BYTES + 1);
    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video: oversized,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow(`video exceeds ${FANVUE_MAX_FILE_BYTES} bytes`);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed media process instead of returning a broken media id', async () => {
    mockFetch.mockResolvedValueOnce(sessionResponse({ totalParts: 1 }));
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ partSize: 4, parts: [{ partNumber: 1, url: partUrl(1) }] }),
    );
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"e1"' } }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'processing' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'error', errorReason: 'unsupported_format' }));

    await expect(
      uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow(FanvueError);
  });
});
