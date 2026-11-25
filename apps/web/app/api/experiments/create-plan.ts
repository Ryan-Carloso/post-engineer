import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import {
  CreateExperimentBodySchema,
  DEFAULT_COMPARISON_WINDOW,
  type CreateExperimentBody,
} from '@/lib/contracts/experiments';
import { UUID } from '@/lib/contracts/metrics';
import { ERROR_CODES, formatErrorMessage, type ErrorCode } from '@/lib/error-codes';
import { checkCustomAudioUrl } from '@/lib/generation/custom-audio';
import { logger } from '@/lib/logger';
import { minimumVideosForClear, projectedGroups } from '@/lib/experiments/min-clear';
import { quoteKeyFor } from '@/lib/experiments/quote-key';
import { readPromptComparison } from '@/lib/experiments/read-comparison';
import { latinSquareRotation } from '@/lib/experiments/rotation';
import type { SupabaseSessionAuth } from '@/lib/request-auth';
import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import { computeVideoTokens } from '@/lib/tokens';
import { resolveEffectiveCta, validateCtaTake, type ResolvedCta } from '../videos/generate-and-schedule/cta-validation';
import { checkPromptVersion } from '../videos/generate-and-schedule/prompt-version';
import { loadBoundPublishingAccounts, resolvePublishingAccounts, type PersonaPrep } from '../videos/generate-and-schedule/persona-prep';
import { preparePost, validationFailed } from '../videos/generate-and-schedule/prepare-persona';
import type { ValidatedOptions } from '../videos/generate-and-schedule/options-validation';
import type { Provider } from '../videos/generate-and-schedule/providers-validation';
import { rejectInvalidRequest, shapeIssues } from '../videos/generate-and-schedule/request-validation';
import { scheduleWarnings, type ScheduleWarning } from '../videos/generate-and-schedule/schedule-warnings';
import { validateSlots, type SlotFieldNames } from '../videos/generate-and-schedule/slot-validation';
import { validateAccounts } from '../videos/generate-and-schedule/validate-accounts';
import { EXPERIMENT_ROUTE, checkExperimentSemantics, mediaIdIssue, shapeCountIssues } from './create-checks';
import { checkExperimentPreflights } from './create-preflights';

const SLOT_FIELDS: SlotFieldNames = { times: 'times', timezone: 'timezone', startAt: 'startAt', window: 'startAt' };

export function experimentError(
  status: number,
  code: ErrorCode,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return apiErrorResponse(status, message, { route: EXPERIMENT_ROUTE, code, field, extra });
}

export function internalError(): NextResponse {
  return experimentError(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
}

export type ExperimentWarning =
  | ScheduleWarning
  | { code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM'; videosPerVariant: number; minimumVideos: number; groups: number }
  | { code: 'EXPERIMENT_HISTORY_UNAVAILABLE' };

export interface PlannedVideo {
  slot: DistributedSlot;
  variantIndex: number;
  videoIndex: number;
  versionId: string;
  title: string;
  description: string;
  script: string;
  segments: CreateExperimentBody['variants'][number]['videos'][number]['segments'];
}

export interface ExperimentPlan {
  userId: string;
  personaId: string | null;
  providers: Provider[];
  accountIds: Record<Provider, string[]>;
  prep: PersonaPrep;
  effectiveCta: ResolvedCta | null;
  options: ValidatedOptions;
  times: string[];
  timezone: string;
  perVideoCost: number;
  totalTokens: number;
  videos: PlannedVideo[];
  warnings: ExperimentWarning[];
  body: CreateExperimentBody;
}

export async function parseExperimentRequest(request: Request): Promise<CreateExperimentBody | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Invalid JSON payload.');
  }
  const parsed = CreateExperimentBodySchema.safeParse(raw);
  if (!parsed.success) return rejectInvalidRequest(shapeIssues(parsed.error));
  return parsed.data;
}

export function quoteKeyOf(plan: ExperimentPlan, expiresAt: string): string {
  return quoteKeyFor({
    userId: plan.userId,
    request: { ...plan.body, quoteKey: undefined, expiresAt: undefined },
    perVideoCost: plan.perVideoCost,
    totalTokens: plan.totalTokens,
    slots: plan.videos.map((video) => ({ slotAt: video.slot.slotAtISO, versionId: video.versionId })),
    expiresAt,
  });
}

async function historyWarning(
  supabase: SupabaseClient,
  auth: SupabaseSessionAuth,
  body: CreateExperimentBody,
  perVariant: number,
): Promise<ExperimentWarning[]> {
  const outcome = await readPromptComparison(supabase, {
    userId: auth.userId,
    window: DEFAULT_COMPARISON_WINDOW,
    personaIds: isScopedApiKey(auth) ? auth.personaIds.filter((id) => UUID.test(id)) : null,
  });
  if (!outcome.ok) {
    logger.error('[experiments-create] prompt comparison read failed', outcome.cause, { userId: auth.userId });
    return [{ code: 'EXPERIMENT_HISTORY_UNAVAILABLE' }];
  }
  const account = outcome.value.accounts.find(
    (candidate) => candidate.provider === body.account.provider && candidate.accountId === body.account.accountId,
  );
  const unversioned = outcome.unversioned.find(
    (candidate) => candidate.provider === body.account.provider && candidate.accountId === body.account.accountId,
  );
  const groups = projectedGroups(account, body.variants.map((variant) => variant.versionId), unversioned?.comparedVideos ?? 0);
  const minimumVideos = minimumVideosForClear(groups);
  if (perVariant >= minimumVideos) return [];
  return [{ code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM', videosPerVariant: perVariant, minimumVideos, groups }];
}

export type ExperimentStage = 'quote' | 'confirm';

export async function buildExperimentPlan(
  supabase: SupabaseClient,
  auth: SupabaseSessionAuth,
  body: CreateExperimentBody,
  stage: ExperimentStage,
): Promise<ExperimentPlan | NextResponse> {
  const userId = auth.userId;
  const personaId = body.personaId?.trim() || null;
  const countIssues = shapeCountIssues(body);
  if (countIssues.length > 0) return rejectInvalidRequest(countIssues);
  const semantics = checkExperimentSemantics(body, personaId);
  if (!semantics.ok) return rejectInvalidRequest(semantics.issues);
  const { options, providers } = semantics;

  for (const [index, variant] of body.variants.entries()) {
    const version = await checkPromptVersion(supabase, {
      versionId: variant.versionId,
      userId,
      allowOwn: !isScopedApiKey(auth),
    });
    if (version === 'error') return internalError();
    if (version === 'not_found') {
      return validationFailed(
        ERROR_CODES.PROMPT_NOT_FOUND,
        `Unknown versionId for variant ${index}: pass the versionId returned with a prompt you can read.`,
        `variants.${index}.versionId`,
        404,
      );
    }
  }

  if (personaId !== null && !isPersonaAllowed(auth.personaIds, personaId)) {
    return validationFailed(ERROR_CODES.PERSONA_SCOPE_DENIED, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), 'personaId', 403);
  }
  if (options.audioUrl !== undefined) {
    const audioCheck = await checkCustomAudioUrl(options.audioUrl);
    if (!audioCheck.ok) return validationFailed(ERROR_CODES.VALIDATION_FAILED, audioCheck.error, 'options.audioUrl');
  }
  const prep = await preparePost(supabase, userId, personaId, options);
  if (prep instanceof NextResponse) return prep;
  const effectiveCta = resolveEffectiveCta(undefined, prep.cta);
  for (const video of semantics.videos) {
    const ctaCheck = validateCtaTake(effectiveCta, body.variants[video.variantIndex].videos[video.videoIndex].segments);
    if (!ctaCheck.ok) {
      const field = `variants.${video.variantIndex}.videos.${video.videoIndex}.segments`;
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, ctaCheck.message, field);
    }
  }

  const bound = await loadBoundPublishingAccounts(supabase, personaId, userId);
  if (bound instanceof NextResponse) return bound;
  const requestedAccounts = { [body.account.provider]: [body.account.accountId] };
  const validatedAccounts = await validateAccounts(
    supabase,
    userId,
    providers,
    await resolvePublishingAccounts(supabase, personaId, requestedAccounts, bound ?? undefined, userId),
    bound,
  );
  if (validatedAccounts instanceof NextResponse) return validatedAccounts;

  const perVariant = body.variants[0].videos.length;
  const slots = validateSlots(body.startAt, body.times, body.timezone, body.variants.length * perVariant, SLOT_FIELDS);
  if (slots instanceof NextResponse) return slots;
  const spanMs = Date.parse(slots[slots.length - 1].slotAtISO) - Date.parse(slots[0].slotAtISO);
  const mediaIssue = mediaIdIssue(body, options.lipsyncPhotos, spanMs);
  if (mediaIssue !== null) return rejectInvalidRequest([mediaIssue]);

  const perVideoCost = computeVideoTokens(options.videoType, prep.faceQuality);
  const rotation = latinSquareRotation(slots, body.variants.length, perVariant);
  const videos: PlannedVideo[] = rotation.map(({ slot, variantIndex, videoIndex }) => {
    const variant = body.variants[variantIndex];
    const checked = semantics.videos.find((entry) => entry.variantIndex === variantIndex && entry.videoIndex === videoIndex);
    if (checked === undefined) throw new Error('experiment video missing from the validated set');
    return {
      slot,
      variantIndex,
      videoIndex,
      versionId: variant.versionId,
      title: checked.checked.title,
      description: checked.checked.description,
      script: checked.checked.script,
      segments: variant.videos[videoIndex].segments,
    };
  });

  const warnings: ExperimentWarning[] = [
    ...scheduleWarnings(prep.voiceFallback, validatedAccounts.reconnectWarning),
    ...(stage === 'quote' ? await historyWarning(supabase, auth, body, perVariant) : []),
  ];
  return {
    userId,
    personaId,
    providers,
    accountIds: validatedAccounts.accountIds,
    prep,
    effectiveCta,
    options,
    times: [...new Set(body.times.map((time) => time.trim()))].sort(),
    timezone: body.timezone,
    perVideoCost,
    totalTokens: perVideoCost * videos.length,
    videos,
    warnings,
    body,
  };
}

export function preflightExperiment(supabase: SupabaseClient, plan: ExperimentPlan): Promise<NextResponse | null> {
  return checkExperimentPreflights(supabase, {
    userId: plan.userId,
    personaId: plan.personaId,
    prep: plan.prep,
    options: plan.options,
    videos: plan.videos,
  });
}

export async function planExperiment(
  supabase: SupabaseClient,
  auth: SupabaseSessionAuth,
  body: CreateExperimentBody,
  stage: ExperimentStage,
): Promise<ExperimentPlan | NextResponse> {
  const plan = await buildExperimentPlan(supabase, auth, body, stage);
  if (plan instanceof NextResponse) return plan;
  const preflight = await preflightExperiment(supabase, plan);
  return preflight ?? plan;
}
