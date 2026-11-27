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
});
