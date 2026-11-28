import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerRequestError,
  buildPublishBody,
  publishExisting,
  uploadMediaFile,
} from '../request';
import type { SubmissionPlan } from '../compose';

type XhrHandler = (event: { lengthComputable: boolean; loaded: number; total: number }) => void;

class FakeXhr {
  static instances: FakeXhr[] = [];
  uploadHandlers: Record<string, XhrHandler> = {};
  loadHandlers: Array<() => void> = [];
  errorHandlers: Array<() => void> = [];
  abortHandlers: Array<() => void> = [];
  status = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  upload = {
    addEventListener: (type: string, handler: XhrHandler): void => {
      this.uploadHandlers[type] = handler;
    },
  };

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  addEventListener(type: string, handler: () => void): void {
    if (type === 'load') this.loadHandlers.push(handler);
    else if (type === 'error') this.errorHandlers.push(handler);
    else if (type === 'abort') this.abortHandlers.push(handler);
  }

  send(body: unknown): void {
    this.body = body;
    FakeXhr.instances.push(this);
  }

  emitProgress(loaded: number, total: number): void {
    this.uploadHandlers.progress?.({ lengthComputable: true, loaded, total });
  }

  emitLoad(status: number): void {
    this.status = status;
    for (const handler of this.loadHandlers) handler();
  }

  emitError(): void {
    for (const handler of this.errorHandlers) handler();
  }

  emitAbort(): void {
    for (const handler of this.abortHandlers) handler();
  }
}

const PLAN: SubmissionPlan = {
  mode: 'asap',
  providers: ['youtube'],
  accounts: { youtube: ['ch-1'] },
  title: 'A day in Lisbon',
  description: 'A short vlog.',
  caption: null,
  tags: ['vlog'],
  privacyStatus: 'public',
  firstComment: null,
  personaId: null,
  pinterestBoardId: null,
  schedule: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPublishBody', () => {
  it('sends the media, publishing plan and idempotency key', () => {
    const body = buildPublishBody(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1');
    expect(body).toEqual({
      media: { kind: 'upload', uploadId: 'upload-1' },
      title: 'A day in Lisbon',
      description: 'A short vlog.',
      publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['ch-1'] } },
      idempotencyKey: 'key-1',
      tags: ['vlog'],
      privacyStatus: 'public',
    });
  });

  it('omits the optional fields when they are absent', () => {
    const body = buildPublishBody(
      { ...PLAN, tags: undefined, privacyStatus: undefined },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(body).toEqual({
      media: { kind: 'upload', uploadId: 'upload-1' },
      title: 'A day in Lisbon',
      description: 'A short vlog.',
      publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['ch-1'] } },
      idempotencyKey: 'key-1',
    });
    expect('tags' in body).toBe(false);
    expect('privacyStatus' in body).toBe(false);
    expect('personaId' in body).toBe(false);
    expect('caption' in body).toBe(false);
    expect('firstComment' in body).toBe(false);
  });

  it('adds the schedule, persona, caption and first comment when present', () => {
    const body = buildPublishBody(
      {
        ...PLAN,
        mode: 'scheduled',
        personaId: 'persona-1',
        caption: 'Caption',
        firstComment: 'First',
        pinterestBoardId: 'board-1',
        schedule: { publishAt: '2026-12-02T20:00', timezone: 'Europe/Lisbon' },
      },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(body.personaId).toBe('persona-1');
    expect(body.caption).toBe('Caption');
    expect(body.firstComment).toBe('First');
    expect(body.publishing).toEqual({
      mode: 'scheduled',
      providers: ['youtube'],
      accounts: { youtube: ['ch-1'] },
      schedule: { publishAt: '2026-12-02T20:00', timezone: 'Europe/Lisbon' },
      pinterestBoardId: 'board-1',
    });
  });
});

describe('uploadMediaFile', () => {
  it('mints, PUTs the bytes to the signed URL and completes the upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign?token=t' }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, uploadId: 'upload-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const progress: number[] = [];
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });

    const pending = uploadMediaFile(file, 'video/mp4', (percent) => progress.push(percent));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://storage.test/sign?token=t');
    expect(xhr.headers['content-type']).toBe('video/mp4');
    expect(xhr.body).toBe(file);
    xhr.emitProgress(50, 100);
    xhr.emitLoad(200);

    await expect(pending).resolves.toEqual({ kind: 'upload', uploadId: 'upload-1' });
    expect(progress).toEqual([50, 100]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/videos/upload-url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ contentType: 'video/mp4', sizeBytes: file.size }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/videos/uploads/upload-1/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails the upload stage when the signed PUT is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign?token=t' }),
        ),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });

    const pending = uploadMediaFile(file, 'video/mp4', () => undefined);
    const rejection = expect(pending).rejects.toMatchObject({ stage: 'upload', status: 403 });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].emitLoad(403);
    await rejection;
  });
});

describe('publishExisting', () => {
  it('returns the scheduled summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'scheduled',
          replayed: false,
          schedule: { id: 'schedule-1' },
          slots: [{ id: 'slot-1', slot_at: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
        }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'Europe/Lisbon' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
    });
  });

  it('parses the asap publish results per provider and account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          mode: 'asap',
          replayed: true,
          publishes: [
            {
              provider: 'youtube',
              success: false,
              results: [
                { accountId: 'ch-1', success: false, error: 'quota' },
                { accountId: 'ch-2', success: true, videoUrl: 'https://youtu.be/x' },
              ],
            },
          ],
        }),
      ),
    );
    const result = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1');
    expect(result).toEqual({
      mode: 'asap',
      success: false,
      replayed: true,
      publishes: [
        {
          provider: 'youtube',
          success: false,
          results: [
            { accountId: 'ch-1', success: false, error: 'quota' },
            { accountId: 'ch-2', success: true, videoUrl: 'https://youtu.be/x' },
          ],
        },
      ],
    });
  });

  it('keeps the per-account errorCode and narrows first-comment warnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          mode: 'asap',
          replayed: false,
          publishes: [
            {
              provider: 'youtube',
              success: false,
              results: [
                {
                  accountId: 'ch-1',
                  success: false,
                  error: 'token revoked',
                  errorCode: 'token_expired',
                  warnings: ['FIRST_COMMENT_FAILED', 'bogus', 4],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1');
    expect(result).toEqual({
      mode: 'asap',
      success: false,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: false,
          results: [
            {
              accountId: 'ch-1',
              success: false,
              error: 'token revoked',
              errorCode: 'token_expired',
              warnings: ['FIRST_COMMENT_FAILED'],
            },
          ],
        },
      ],
    });
  });

  it('parses top-level reconnect warnings on a scheduled result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'scheduled',
          replayed: false,
          schedule: { id: 'schedule-1' },
          slots: [{ id: 'slot-1', slot_at: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
          warnings: [
            { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] },
          ],
        }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'Europe/Lisbon' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
      warnings: [
        { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] },
      ],
    });
  });

  it('leaves warnings absent on a scheduled result without them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'scheduled',
          replayed: false,
          schedule: { id: 'schedule-1' },
          slots: [{ id: 'slot-1', slot_at: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
        }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'Europe/Lisbon' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'T', status: 'ready' }],
    });
    expect('warnings' in result).toBe(false);
  });

  it('raises a publish error carrying the server field and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, error: 'too soon', field: 'publishing.schedule.publishAt', code: 'SCHEDULE_OUT_OF_RANGE' },
            400,
          ),
        ),
    );
    const error = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-01T01:00', timezone: 'UTC' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ComposerRequestError);
    expect(error).toMatchObject({
      stage: 'publish',
      status: 400,
      field: 'publishing.schedule.publishAt',
      code: 'SCHEDULE_OUT_OF_RANGE',
    });
  });

  it('fails the publish stage when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const error = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'publish', status: null, serverError: null, field: null, code: null });
  });

  it('fails the publish stage on a non-record payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(['not-a-record'])));
    const error = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'publish', status: 200 });
  });

  it('fails the publish stage on an unknown mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, mode: 'later' })));
    const error = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'publish', status: 200 });
  });

  it('fails the publish stage when a scheduled result has no schedule id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, mode: 'scheduled', schedule: {}, slots: [] })),
    );
    const error = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'publish', status: 200 });
  });

  it('defaults missing slot titles and statuses to empty strings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'scheduled',
          replayed: true,
          schedule: { id: 'schedule-1' },
          slots: [
            { id: 'slot-1', slot_at: '2026-12-02T20:00:00Z' },
            { id: 'slot-2', slot_at: '2026-12-03T20:00:00Z', title: 42, status: ['ready'] },
          ],
        }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'UTC' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({
      mode: 'scheduled',
      replayed: true,
      scheduleId: 'schedule-1',
      slots: [
        { id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: '', status: '' },
        { id: 'slot-2', slotAt: '2026-12-03T20:00:00Z', title: '', status: '' },
      ],
    });
  });

  it('returns no slots when the slots value is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ success: true, mode: 'scheduled', schedule: { id: 'schedule-1' }, slots: 'nope' }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'UTC' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({ mode: 'scheduled', replayed: false, scheduleId: 'schedule-1', slots: [] });
  });

  it('skips malformed slots and keeps the well-formed ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'scheduled',
          schedule: { id: 'schedule-1' },
          slots: [
            { slot_at: '2026-12-02T20:00:00Z' },
            { id: 'slot-1' },
            'plain-string',
            { id: 'slot-2', slot_at: '2026-12-03T20:00:00Z', title: 'T', status: 'ready' },
          ],
        }),
      ),
    );
    const result = await publishExisting(
      { ...PLAN, mode: 'scheduled', schedule: { publishAt: '2026-12-02T20:00', timezone: 'UTC' } },
      { kind: 'upload', uploadId: 'upload-1' },
      'key-1',
    );
    expect(result).toEqual({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-2', slotAt: '2026-12-03T20:00:00Z', title: 'T', status: 'ready' }],
    });
  });

  it('returns no publishes when the publishes value is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, mode: 'asap', publishes: 'nope' })),
    );
    const result = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1');
    expect(result).toEqual({ mode: 'asap', success: true, replayed: false, publishes: [] });
  });

  it('skips malformed providers and account results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          mode: 'asap',
          publishes: [
            { results: [] },
            'plain-string',
            {
              provider: 'youtube',
              success: true,
              results: [
                { success: true },
                'plain-string',
                { accountId: 'ch-1', success: true, permalink: 'https://youtu.be/x', postId: 'p-1', videoId: 'v-1' },
              ],
            },
            { provider: 'instagram', success: false },
          ],
        }),
      ),
    );
    const result = await publishExisting(PLAN, { kind: 'upload', uploadId: 'upload-1' }, 'key-1');
    expect(result).toEqual({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: true,
          results: [
            {
              accountId: 'ch-1',
              success: true,
              error: undefined,
              videoUrl: undefined,
              permalink: 'https://youtu.be/x',
              postId: 'p-1',
              videoId: 'v-1',
            },
          ],
        },
        { provider: 'instagram', success: false, results: [] },
      ],
    });
  });
});

describe('uploadMediaFile failures', () => {
  it('fails the mint stage when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const error = await uploadMediaFile(file, 'video/mp4', () => undefined).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'mint', status: null });
  });

  it('fails the mint stage on a non-ok response carrying the server fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'too big', field: 'sizeBytes', code: 'TOO_LARGE' }, 413)),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const error = await uploadMediaFile(file, 'video/mp4', () => undefined).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      stage: 'mint',
      status: 413,
      serverError: 'too big',
      field: 'sizeBytes',
      code: 'TOO_LARGE',
    });
  });

  it('fails the mint stage on a non-ok response with an unreadable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 400 })),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const error = await uploadMediaFile(file, 'video/mp4', () => undefined).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'mint', status: 400, serverError: null, field: null, code: null });
  });

  it('fails the mint stage on non-string server error fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 42, field: ['x'], code: null }, 400)),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const error = await uploadMediaFile(file, 'video/mp4', () => undefined).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'mint', status: 400, serverError: null, field: null, code: null });
  });

  it('fails the mint stage when the mint payload has no signed URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, uploadId: 'upload-1' })),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const error = await uploadMediaFile(file, 'video/mp4', () => undefined).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ stage: 'mint', status: 200 });
  });

  it('fails the upload stage when the request errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign' }),
      ),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const pending = uploadMediaFile(file, 'video/mp4', () => undefined);
    const rejection = expect(pending).rejects.toMatchObject({ stage: 'upload', status: null });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].emitError();
    await rejection;
  });

  it('fails the upload stage when the request is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign' }),
      ),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const pending = uploadMediaFile(file, 'video/mp4', () => undefined);
    const rejection = expect(pending).rejects.toMatchObject({ stage: 'upload', status: null });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].emitAbort();
    await rejection;
  });

  it('ignores progress events without a computable length', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign' }),
        )
        .mockResolvedValueOnce(jsonResponse({ success: true, uploadId: 'upload-1' })),
    );
    const progress: number[] = [];
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const pending = uploadMediaFile(file, 'video/mp4', (percent) => progress.push(percent));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    xhr.uploadHandlers.progress?.({ lengthComputable: false, loaded: 50, total: 100 });
    xhr.uploadHandlers.progress?.({ lengthComputable: true, loaded: 50, total: 0 });
    xhr.emitLoad(200);
    await expect(pending).resolves.toEqual({ kind: 'upload', uploadId: 'upload-1' });
    expect(progress).toEqual([100]);
  });

  it('fails the complete stage when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign' }),
        )
        .mockRejectedValueOnce(new Error('network down')),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const pending = uploadMediaFile(file, 'video/mp4', () => undefined);
    const rejection = expect(pending).rejects.toMatchObject({ stage: 'complete', status: null });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].emitLoad(200);
    await rejection;
  });

  it('fails the complete stage on a non-ok response carrying the server fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ success: true, uploadId: 'upload-1', signedUrl: 'https://storage.test/sign' }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ error: 'gone', field: 'uploadId', code: 'VIDEO_UPLOAD_NOT_FOUND' }, 404),
        ),
    );
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const pending = uploadMediaFile(file, 'video/mp4', () => undefined);
    const rejection = expect(pending).rejects.toMatchObject({
      stage: 'complete',
      status: 404,
      serverError: 'gone',
      field: 'uploadId',
      code: 'VIDEO_UPLOAD_NOT_FOUND',
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].emitLoad(200);
    await rejection;
  });
});
