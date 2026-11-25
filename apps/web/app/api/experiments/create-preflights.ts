import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { checkPreChargePreflights } from '../videos/generate-and-schedule/aspect-preflight';
import { checkLipsyncPhotoFaces } from '../videos/generate-and-schedule/lipsync-photo-faces';
import { validatePreChargeImageId } from '../videos/generate-and-schedule/library-photo';
import type { ValidatedOptions } from '../videos/generate-and-schedule/options-validation';
import type { PersonaPrep } from '../videos/generate-and-schedule/persona-prep';
import { createPreflightShared, type PreflightShared } from '../videos/generate-and-schedule/preflight-shared';
import { resolveVideoAspect } from '../videos/generate-and-schedule/video-aspect';
import { EXPERIMENT_ROUTE, SEGMENTS_FIELD } from './create-checks';
import type { PlannedVideo } from './create-plan';
import { EXPERIMENT_PREFLIGHT_BUDGET_MS, PREFLIGHT_CONCURRENCY } from './preflight-budget';

export interface ExperimentPreflightInput {
  userId: string;
  personaId: string | null;
  prep: PersonaPrep;
  options: ValidatedOptions;
  videos: PlannedVideo[];
  budgetMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function locateFailure(failure: NextResponse, video: PlannedVideo): Promise<NextResponse> {
  if (failure.status >= 500) return failure;
  const body: unknown = await failure.clone().json().catch(() => null);
  if (!isRecord(body) || typeof body.error !== 'string') return failure;
  const prefix = `variants.${video.variantIndex}.videos.${video.videoIndex}`;
  const field = body.field === SEGMENTS_FIELD ? `${prefix}.segments` : body.field;
  return apiErrorResponse(failure.status, `Variant ${video.variantIndex} video ${video.videoIndex}: ${body.error}`, {
    route: EXPERIMENT_ROUTE,
    code: typeof body.code === 'string' ? body.code : undefined,
    field: typeof field === 'string' ? field : undefined,
  });
}

function budgetExceeded(budgetMs: number, videoType: ValidatedOptions['videoType']): NextResponse {
  const lipsyncLimit =
    videoType === 'full_lipsync' ? ' Full lip-sync checks the narration of every video, which is the slowest check, so fewer videos helps most.' : '';
  return apiErrorResponse(
    504,
    `Checking the media of this experiment took longer than ${Math.ceil(budgetMs / 1000)}s and was stopped before anything was charged: send fewer videos or fewer distinct media items, then try again.${lipsyncLimit}`,
    { route: EXPERIMENT_ROUTE, code: ERROR_CODES.ENGINE_UNAVAILABLE },
  );
}

async function checkLipsyncPhotosOnce(
  userId: string,
  prep: PersonaPrep,
  options: ValidatedOptions,
  shared: PreflightShared,
): Promise<NextResponse | null> {
  if (options.videoType !== 'full_lipsync') return null;
  const videoAspect = resolveVideoAspect(options, prep);
  if (videoAspect instanceof NextResponse) return videoAspect;
  return checkLipsyncPhotoFaces(userId, options.lipsyncPhotos ?? [], videoAspect, shared);
}

async function checkVideosInBatches(
  input: ExperimentPreflightInput,
  shared: PreflightShared,
  budgetMs: number,
): Promise<NextResponse | null> {
  const { userId, prep, options, videos } = input;
  for (let start = 0; start < videos.length; start += PREFLIGHT_CONCURRENCY) {
    if (shared.signal.aborted) return budgetExceeded(budgetMs, options.videoType);
    const batch = videos.slice(start, start + PREFLIGHT_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((video) =>
        checkPreChargePreflights({
          userId,
          script: video.script,
          prep,
          options,
          segments: video.segments,
          shared,
          skipLipsyncPhotoFaces: true,
        }),
      ),
    );
    const failed = outcomes.flatMap((outcome, offset) => (outcome === null ? [] : [{ outcome, video: batch[offset] }]));
    const decisive = failed.find(({ outcome }) => outcome.status < 500) ?? failed[0];
    if (decisive !== undefined) return locateFailure(decisive.outcome, decisive.video);
  }
  return null;
}

export async function checkExperimentPreflights(
  supabase: SupabaseClient,
  input: ExperimentPreflightInput,
): Promise<NextResponse | null> {
  const { userId, personaId, prep, options, videos } = input;
  const budgetMs = input.budgetMs ?? EXPERIMENT_PREFLIGHT_BUDGET_MS;
  const requestedImageId = personaId !== null ? options.imageId?.trim() || null : null;
  const imageCheck = await validatePreChargeImageId(supabase, {
    personaId,
    userId,
    title: videos[0].title,
    script: videos[0].script,
    requestedImageId,
    prep,
  });
  if (imageCheck !== null) return imageCheck;
  const shared = createPreflightShared(budgetMs);
  const photos = await checkLipsyncPhotosOnce(userId, prep, options, shared);
  const failure = photos ?? (await checkVideosInBatches(input, shared, budgetMs));
  if (failure !== null && failure.status >= 500 && shared.signal.aborted) return budgetExceeded(budgetMs, options.videoType);
  return failure;
}
