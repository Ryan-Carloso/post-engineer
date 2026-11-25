import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { checkPreChargePreflights } from '../videos/generate-and-schedule/aspect-preflight';
import { validatePreChargeImageId } from '../videos/generate-and-schedule/library-photo';
import type { ValidatedOptions } from '../videos/generate-and-schedule/options-validation';
import type { PersonaPrep } from '../videos/generate-and-schedule/persona-prep';
import { EXPERIMENT_ROUTE, SEGMENTS_FIELD } from './create-checks';
import type { PlannedVideo } from './create-plan';

export const PREFLIGHT_CONCURRENCY = 4;

export interface ExperimentPreflightInput {
  userId: string;
  personaId: string | null;
  prep: PersonaPrep;
  options: ValidatedOptions;
  videos: PlannedVideo[];
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
  return apiErrorResponse(failure.status, `Video ${video.videoIndex + 1} of variant ${video.variantIndex}: ${body.error}`, {
    route: EXPERIMENT_ROUTE,
    code: typeof body.code === 'string' ? body.code : undefined,
    field: typeof field === 'string' ? field : undefined,
  });
}

export async function checkExperimentPreflights(
  supabase: SupabaseClient,
  input: ExperimentPreflightInput,
): Promise<NextResponse | null> {
  const { userId, personaId, prep, options, videos } = input;
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
  for (let start = 0; start < videos.length; start += PREFLIGHT_CONCURRENCY) {
    const batch = videos.slice(start, start + PREFLIGHT_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((video) => checkPreChargePreflights({ userId, script: video.script, prep, options, segments: video.segments })),
    );
    for (const [offset, outcome] of outcomes.entries()) {
      if (outcome !== null) return locateFailure(outcome, batch[offset]);
    }
  }
  return null;
}
