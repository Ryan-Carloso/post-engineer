// @vitest-environment node
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('../../videos/generate-and-schedule/aspect-preflight', () => ({ checkPreChargePreflights: vi.fn() }));
vi.mock('../../videos/generate-and-schedule/library-photo', () => ({ validatePreChargeImageId: vi.fn() }));
vi.mock('../../videos/generate-and-schedule/lipsync-photo-faces', () => ({ checkLipsyncPhotoFaces: vi.fn() }));

import { checkPreChargePreflights } from '../../videos/generate-and-schedule/aspect-preflight';
import { validatePreChargeImageId } from '../../videos/generate-and-schedule/library-photo';
import { checkLipsyncPhotoFaces } from '../../videos/generate-and-schedule/lipsync-photo-faces';
import type { ValidatedOptions } from '../../videos/generate-and-schedule/options-validation';
import type { PersonaPrep } from '../../videos/generate-and-schedule/persona-prep';
import type { PlannedVideo } from '../create-plan';
import { EXPERIMENT_PREFLIGHT_BUDGET_MS, PREFLIGHT_CONCURRENCY, checkExperimentPreflights } from '../create-preflights';
import { segmentsFor } from './create-fixtures';

const SUPABASE = { marker: 'db' } as unknown as SupabaseClient;
const PREP = { personaName: 'Maria', niche: 'travel' } as unknown as PersonaPrep;
const OPTIONS = { videoType: 'voiceover', imageId: ' img-1 ' } as unknown as ValidatedOptions;

function videos(count: number, perVariant = count): PlannedVideo[] {
  return Array.from({ length: count }, (_, index) => ({
    slot: { slotAtISO: new Date(Date.UTC(2030, 0, 1 + index)).toISOString(), dayIndex: index, timeIndex: 0 },
    variantIndex: Math.floor(index / perVariant),
    videoIndex: index % perVariant,
    versionId: `v-${Math.floor(index / perVariant)}`,
    title: `Title ${index}`,
    description: `Description ${index}`,
    script: `Script ${index}`,
    segments: segmentsFor(),
  }));
}

function failure(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: false, ...body }, { status });
}

const LIPSYNC_PHOTOS = [{ url: 'https://e.com/face-0.jpg' }, { mediaId: 'ffeeddccbbaa99887766554433221100.jpg' }];
const LIPSYNC_OPTIONS = { videoType: 'full_lipsync', lipsyncPhotos: LIPSYNC_PHOTOS } as unknown as ValidatedOptions;

async function run(
  planned: PlannedVideo[],
  personaId: string | null = 'persona-1',
  options = OPTIONS,
  extra: { prep?: PersonaPrep; budgetMs?: number } = {},
) {
  return checkExperimentPreflights(SUPABASE, {
    userId: 'user-1',
    personaId,
    prep: extra.prep ?? PREP,
    options,
    videos: planned,
    budgetMs: extra.budgetMs,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkPreChargePreflights).mockResolvedValue(null);
  vi.mocked(validatePreChargeImageId).mockResolvedValue(null);
  vi.mocked(checkLipsyncPhotoFaces).mockResolvedValue(null);
});

describe('checkExperimentPreflights', () => {
  it('runs the pre-charge preflights once per video with that video script and segments', async () => {
    const planned = videos(6);

    expect(await run(planned)).toBeNull();

    const calls = vi.mocked(checkPreChargePreflights).mock.calls.map((call) => call[0]);
    expect(calls).toHaveLength(6);
    expect(calls.map((call) => call.script)).toEqual(planned.map((video) => video.script));
    expect(calls.every((call, index) => call.segments === planned[index].segments && call.userId === 'user-1')).toBe(true);
    expect(calls[0]).toMatchObject({ prep: PREP, options: OPTIONS });
  });

  it('gives every video the same shared context and leaves the lipsync photo faces to the experiment', async () => {
    await run(videos(6));

    const calls = vi.mocked(checkPreChargePreflights).mock.calls.map((call) => call[0]);
    expect(calls[0].shared).toBeDefined();
    expect(calls.every((call) => call.shared === calls[0].shared)).toBe(true);
    expect(calls.every((call) => call.skipLipsyncPhotoFaces === true)).toBe(true);
  });

  it('validates the requested persona image once, with the first video', async () => {
    await run(videos(6));

    expect(validatePreChargeImageId).toHaveBeenCalledTimes(1);
    expect(validatePreChargeImageId).toHaveBeenCalledWith(SUPABASE, {
      personaId: 'persona-1',
      userId: 'user-1',
      title: 'Title 0',
      script: 'Script 0',
      requestedImageId: 'img-1',
      prep: PREP,
    });
  });

  it('asks for no image check without a persona', async () => {
    await run(videos(2), null);

    expect(vi.mocked(validatePreChargeImageId).mock.calls[0]?.[1]).toMatchObject({ personaId: null, requestedImageId: null });
  });

  it('returns an image failure before any media is checked', async () => {
    const imageFailure = failure(404, { error: 'Unknown image.', code: 'VALIDATION_FAILED', field: 'options.imageId' });
    vi.mocked(validatePreChargeImageId).mockResolvedValue(imageFailure);

    expect(await run(videos(3))).toBe(imageFailure);
    expect(checkPreChargePreflights).not.toHaveBeenCalled();
  });

  it('names the variant and video that failed and points the field at its segments', async () => {
    vi.mocked(checkPreChargePreflights).mockImplementation(async (input) =>
      input.script === 'Script 7'
        ? failure(400, { error: 'Segment 2 image 0 is 1080x1080 (1:1), but this video is 9:16.', code: 'VALIDATION_FAILED', field: 'options.segments' })
        : null,
    );

    const response = await run(videos(10, 5));

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      field: 'variants.1.videos.2.segments',
      error: 'Variant 1 video 2: Segment 2 image 0 is 1080x1080 (1:1), but this video is 9:16.',
    });
  });

  it('reports the earliest failing video when several fail in the same batch', async () => {
    vi.mocked(checkPreChargePreflights).mockImplementation(async (input) =>
      input.script === 'Script 1' || input.script === 'Script 2'
        ? failure(400, { error: `bad ${input.script}`, code: 'VALIDATION_FAILED', field: 'options.segments' })
        : null,
    );

    const response = await run(videos(4));

    expect((await response?.json()).field).toBe('variants.0.videos.1.segments');
  });

  it('keeps a field that is not the segments, such as personaId', async () => {
    vi.mocked(checkPreChargePreflights).mockResolvedValue(failure(400, { error: 'Persona video aspect is odd.', code: 'VALIDATION_FAILED', field: 'personaId' }));

    expect((await (await run(videos(2)))?.json()).field).toBe('personaId');
  });

  it('passes an engine outage through unchanged', async () => {
    const outage = failure(502, { error: 'Video service is unavailable.', code: 'INTERNAL_ERROR' });
    vi.mocked(checkPreChargePreflights).mockResolvedValue(outage);

    expect(await run(videos(2))).toBe(outage);
  });

  it('checks at most the batch size at once and stops after the batch that failed', async () => {
    let running = 0;
    let peak = 0;
    vi.mocked(checkPreChargePreflights).mockImplementation(async (input) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return input.script === 'Script 1' ? failure(400, { error: 'bad', code: 'VALIDATION_FAILED', field: 'options.segments' }) : null;
    });

    await run(videos(40, 20));

    expect(peak).toBe(PREFLIGHT_CONCURRENCY);
    expect(checkPreChargePreflights).toHaveBeenCalledTimes(PREFLIGHT_CONCURRENCY);
  });

  it('checks the lipsync photos once for the whole experiment, not once per video', async () => {
    expect(await run(videos(40, 20), 'persona-1', LIPSYNC_OPTIONS)).toBeNull();

    const shared = vi.mocked(checkPreChargePreflights).mock.calls[0]?.[0].shared;
    expect(checkLipsyncPhotoFaces).toHaveBeenCalledTimes(1);
    expect(checkLipsyncPhotoFaces).toHaveBeenCalledWith('user-1', LIPSYNC_PHOTOS, '9:16', shared);
    expect(checkPreChargePreflights).toHaveBeenCalledTimes(40);
  });

  it('checks the lipsync photos at the aspect of the video', async () => {
    const landscape = { ...LIPSYNC_OPTIONS, videoAspect: '16:9' } as unknown as ValidatedOptions;

    await run(videos(2), 'persona-1', landscape);

    expect(vi.mocked(checkLipsyncPhotoFaces).mock.calls[0]?.[2]).toBe('16:9');
  });

  it('does not check lipsync photos for any other video type', async () => {
    await run(videos(3));

    expect(checkLipsyncPhotoFaces).not.toHaveBeenCalled();
  });

  it('returns a lipsync photo failure as it is, before any video is checked', async () => {
    const faceFailure = failure(400, { error: 'options.lipsyncPhotos.1 has no detectable face.', code: 'VALIDATION_FAILED', field: 'options.lipsyncPhotos.1' });
    vi.mocked(checkLipsyncPhotoFaces).mockResolvedValue(faceFailure);

    expect(await run(videos(3), 'persona-1', LIPSYNC_OPTIONS)).toBe(faceFailure);
    expect(checkPreChargePreflights).not.toHaveBeenCalled();
  });

  it('rejects a persona aspect no format uses before checking any lipsync photo or video', async () => {
    const odd = { personaName: 'Maria', videoAspect: '4:3' } as unknown as PersonaPrep;

    const response = await run(videos(3), 'persona-1', LIPSYNC_OPTIONS, { prep: odd });

    expect(response?.status).toBe(400);
    expect((await response?.json()).field).toBe('personaId');
    expect(checkLipsyncPhotoFaces).not.toHaveBeenCalled();
    expect(checkPreChargePreflights).not.toHaveBeenCalled();
  });

  it('pins the time budget below a 100 second proxy limit', () => {
    expect(EXPERIMENT_PREFLIGHT_BUDGET_MS).toBe(60_000);
  });

  it('fails closed with a clear error when a check is still running at the budget', async () => {
    vi.mocked(checkPreChargePreflights).mockImplementation(async (input) => {
      await new Promise<void>((resolve) => input.shared?.signal.addEventListener('abort', () => resolve()));
      return failure(502, { error: 'Video service is unavailable.', code: 'INTERNAL_ERROR' });
    });

    const response = await run(videos(8), 'persona-1', OPTIONS, { budgetMs: 20 });

    expect(response?.status).toBe(504);
    const json = await response?.json();
    expect(json.code).toBe('ENGINE_UNAVAILABLE');
    expect(json.error).toContain('took longer than 1s');
    expect(json.error).toContain('before anything was charged');
    expect(checkPreChargePreflights).toHaveBeenCalledTimes(PREFLIGHT_CONCURRENCY);
  });

  it('starts no further batch once the budget ran out between batches', async () => {
    vi.mocked(checkPreChargePreflights).mockImplementation(async () => {
      await sleep(40);
      return null;
    });

    const response = await run(videos(12), 'persona-1', OPTIONS, { budgetMs: 15 });

    expect(response?.status).toBe(504);
    expect(checkPreChargePreflights).toHaveBeenCalledTimes(PREFLIGHT_CONCURRENCY);
  });

  it('keeps a real validation failure that arrives within the budget', async () => {
    vi.mocked(checkPreChargePreflights).mockResolvedValue(failure(400, { error: 'bad', code: 'VALIDATION_FAILED', field: 'options.segments' }));

    const response = await run(videos(2), 'persona-1', OPTIONS, { budgetMs: 5_000 });

    expect(response?.status).toBe(400);
  });

  it.each([
    ['before', 'Script 0', 'Script 1', 'variants.0.videos.1.segments'],
    ['after', 'Script 1', 'Script 0', 'variants.0.videos.0.segments'],
  ])('keeps a real validation failure over the budget error when the hung check comes %s it', async (_order, hungScript, badScript, field) => {
    vi.mocked(checkPreChargePreflights).mockImplementation(async (input) => {
      if (input.script === badScript) return failure(400, { error: 'bad aspect', code: 'VALIDATION_FAILED', field: 'options.segments' });
      if (input.script !== hungScript) return null;
      await new Promise<void>((resolve) => input.shared?.signal.addEventListener('abort', () => resolve()));
      return failure(502, { error: 'Video service is unavailable.', code: 'INTERNAL_ERROR' });
    });

    const response = await run(videos(4), 'persona-1', OPTIONS, { budgetMs: 30 });

    expect(response?.status).toBe(400);
    const json = await response?.json();
    expect(json.field).toBe(field);
    expect(json.error).toContain('bad aspect');
  });

  it('reports a budget that expired during the lipsync photo checks', async () => {
    vi.mocked(checkLipsyncPhotoFaces).mockImplementation(async (_userId, _photos, _aspect, shared) => {
      await new Promise<void>((resolve) => shared?.signal.addEventListener('abort', () => resolve()));
      return failure(502, { error: 'Video service is unavailable.', code: 'INTERNAL_ERROR' });
    });

    const response = await run(videos(3), 'persona-1', LIPSYNC_OPTIONS, { budgetMs: 20 });

    expect(response?.status).toBe(504);
    expect(checkPreChargePreflights).not.toHaveBeenCalled();
  });
});
