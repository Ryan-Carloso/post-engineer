import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { ApiError } from '../errors.js';
import { GeneratePersonaVideoBatchSchema, handleGeneratePersonaVideoBatch } from '../tools-batch.js';

//---------------
// generate_persona_video_batch (issue #487). The client is mocked at its
// boundary: generatePersonaVideo() for each video and request() for
// POST /api/videos/batch-discount.
//---------------

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const SEGMENTS = [
  { kind: 'hook' as const, text: 'Here is a small squat detail that quietly changes how your legs grow over the next few months.', media: photos(3, 'hook') },
  { kind: 'body' as const, text: 'Most people bounce at the bottom of the squat, which moves the load off the legs and onto the lower back, so slow the last inch down and pause before you drive up again. Keep your chest tall and brace before every single rep.', media: photos(6, 'body') },
  { kind: 'cta' as const, text: 'Follow for one fix a day.', media: photos(1, 'cta') },
];

function video(title: string) {
  return {
    title,
    segments: SEGMENTS,
    personaId: '11111111-2222-4333-8444-555555555555',
    providers: ['youtube'],
    youtubeAccountIds: ['chan-1'],
    startAt: '2026-11-10T18:00:00',
    times: ['18:00'],
  };
}

function batchArgs(count: number, overrides: Record<string, unknown> = {}) {
  return GeneratePersonaVideoBatchSchema.parse({
    batchKey: 'launch-week',
    videos: Array.from({ length: count }, (_, i) => video(`Video ${i + 1}`)),
    ...overrides,
  });
}

function scheduled(id: string, status = 'generating') {
  return { success: true, schedule: { id, mode: 'scheduled' }, slots: [{ slotId: `slot-${id}`, slotAt: '2026-11-10T18:00:00Z', title: id, taskId: `task-${id}`, status }], replayed: false };
}

const DISCOUNT = {
  success: true,
  batchId: 'b',
  videos: 6,
  faceVideos: 6,
  earnedFreeVideos: 1,
  freeVideos: [{ scheduleId: 's6', slotId: 'slot-s6', discountTokens: 2 }],
  discountTokens: 2,
  chargedTokens: 10,
  warnings: [],
};

function mockClient(overrides: Partial<Record<'request' | 'generatePersonaVideo', ReturnType<typeof vi.fn>>> = {}) {
  let n = 0;
  const client = {
    request: overrides.request ?? vi.fn(async () => DISCOUNT),
    getHeaders: () => ({ Authorization: 'Bearer k' }),
    generatePersonaVideo: overrides.generatePersonaVideo ?? vi.fn(async () => scheduled(`s${(n += 1)}`)),
  };
  return client as unknown as PostEngineerClient & typeof client;
}

function text(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('\n');
}

describe('generate_persona_video_batch schema', () => {
  it('accepts 2 to 12 videos and a slug batchKey', () => {
    expect(batchArgs(2).videos).toHaveLength(2);
    expect(batchArgs(12).videos).toHaveLength(12);
    expect(() => batchArgs(1)).toThrow();
    expect(() => batchArgs(13)).toThrow();
    expect(() => batchArgs(2, { batchKey: 'has space' })).toThrow();
    expect(() => batchArgs(2, { batchKey: 'x'.repeat(101) })).toThrow();
  });

  it('rejects per-video idempotencyKey, experiment and recipe (the batch owns them)', () => {
    for (const extra of [{ idempotencyKey: 'k' }, { experiment: { experimentId: 'e', variantId: 'v', pair: 1 } }, { recipe: 'r' }]) {
      expect(() =>
        GeneratePersonaVideoBatchSchema.parse({ batchKey: 'k', videos: [video('a'), { ...video('b'), ...extra }] }),
      ).toThrow();
    }
  });
});

describe('generate_persona_video_batch', () => {
  it('creates every video in order with deterministic keys, then applies the discount once', async () => {
    const client = mockClient();
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(6));
    expect(response.isError).toBeUndefined();
    const calls = client.generatePersonaVideo.mock.calls.map((call) => call[0]);
    expect(calls.map((c) => c.title)).toEqual(['Video 1', 'Video 2', 'Video 3', 'Video 4', 'Video 5', 'Video 6']);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `batch-launch-week-v${i}`));
    expect(client.request).toHaveBeenCalledTimes(1);
    const [path, init] = client.request.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe('/api/videos/batch-discount');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ batchKey: 'launch-week', scheduleIds: ['s1', 's2', 's3', 's4', 's5', 's6'] });
    expect(text(response)).toContain('Created 6 video(s) in batch launch-week.');
    expect(text(response)).toContain('6 face video(s); 1 free (2 token(s) credited back); 10 token(s) charged in total.');
  });

  it('tells how many more face videos earn the next free one', async () => {
    const client = mockClient({ request: vi.fn(async () => ({ ...DISCOUNT, videos: 4, faceVideos: 4, earnedFreeVideos: 0, freeVideos: [], discountTokens: 0 })) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(4));
    expect(text(response)).toContain('2 more face video(s) in this batch would make one more video free.');
  });

  it('does not promise another free video when faceless videos already fill the batch', async () => {
    const client = mockClient({
      request: vi.fn(async () => ({ ...DISCOUNT, videos: 12, faceVideos: 6, earnedFreeVideos: 1 })),
    });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(12));
    expect(text(response)).not.toContain('more face video');
  });

  it('stops at the first video that fails, keeps the discount for the created ones, and reports an error', async () => {
    let n = 0;
    const generatePersonaVideo = vi.fn(async () => {
      n += 1;
      if (n === 3) throw new Error('Insufficient tokens');
      return scheduled(`s${n}`);
    });
    const client = mockClient({ generatePersonaVideo });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(6));
    expect(response.isError).toBe(true);
    expect(generatePersonaVideo).toHaveBeenCalledTimes(3);
    const [, init] = client.request.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).scheduleIds).toEqual(['s1', 's2']);
    expect(text(response)).toContain('Batch launch-week stopped: 2 of 6 video(s) created.');
    expect(text(response)).toContain('Video 3 of 6 was not created');
  });

  it('makes no discount call when no video was created', async () => {
    const client = mockClient({ generatePersonaVideo: vi.fn(async () => { throw new Error('bad persona'); }) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(2));
    expect(response.isError).toBe(true);
    expect(client.request).not.toHaveBeenCalled();
    expect(text(response)).toContain('No video was created, so no batch discount applies.');
  });

  it('flags a video whose generation failed but still counts its schedule', async () => {
    let n = 0;
    const client = mockClient({ generatePersonaVideo: vi.fn(async () => scheduled(`s${(n += 1)}`, n === 2 ? 'failed' : 'generating')) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(2));
    expect(text(response)).toContain('Video 2 (its generation failed; its tokens are refunded)');
    const [, init] = client.request.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).scheduleIds).toEqual(['s1', 's2']);
  });

  it('reports a failed discount call as an error with the retry instruction', async () => {
    const client = mockClient({ request: vi.fn(async () => { throw new Error('socket hang up'); }) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(6));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('The batch discount could not be applied');
    expect(text(response)).toContain('socket hang up');
    expect(text(response)).toContain('created videos replay without a new charge');
  });

  it('does not tell the agent to retry a discount this batch can never earn', async () => {
    const client = mockClient({
      request: vi.fn(async () => {
        throw new ApiError('Failed to apply batch discount: 409 A video is already part of another batch.', 'BATCH_CONFLICT', null);
      }),
    });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(6));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('already part of another batch');
    expect(text(response)).toContain('cannot earn the discount');
    expect(text(response)).not.toContain('call generate_persona_video_batch again');
  });

  it('reports server warnings (credit not applied) as an error', async () => {
    const client = mockClient({ request: vi.fn(async () => ({ ...DISCOUNT, freeVideos: [], discountTokens: 0, warnings: ['BATCH_DISCOUNT_CREDIT_FAILED'] })) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(6));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('BATCH_DISCOUNT_CREDIT_FAILED');
  });

  it('reports an unreadable discount answer as an error', async () => {
    const client = mockClient({ request: vi.fn(async () => ({ success: true })) });
    const response = await handleGeneratePersonaVideoBatch(client, batchArgs(2));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('could not be read');
  });
});
