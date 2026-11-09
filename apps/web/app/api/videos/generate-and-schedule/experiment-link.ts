//---------------
// Experiment link for POST /api/videos/generate-and-schedule (issue #476).
// A video can join a paired A/B experiment: `experiment: { experimentId,
// variantId, pair }`. Everything here runs BEFORE the charge, so a bad link
// never costs tokens.
//
// Fairness is checked per pair: when the other variant's video of the same
// pair already exists, this video must match it in everything except the
// hook — providers, accounts, voice (id and audio URL), faceless, faceless
// material, full lip-sync, title, aspect, layout, paragraph number, face
// quality, language, niche, CTA text and every non-hook segment — and its
// hook must differ. Persona is checked against the experiment for every
// video. The pinned `options.imageId` is NOT compared: it is not stored on
// the schedule or the slot, so the server cannot see the partner's value.
//
// Two concurrent calls for the two variants can both see an empty pair, so
// verifyExperimentPairAfterInsert re-runs the comparison once this video's
// slot is inserted (the route rolls the video back when it fails).
//
// Service role bypasses RLS: every query is scoped to the user — directly by
// user_id, or through an experiment id whose ownership was checked first.
//---------------

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { EXPERIMENT_TARGET_PAIRS_MAX, EXPERIMENT_VARIANT_ID_PATTERN } from '@/lib/experiments/limits';
import { logger } from '@/lib/logger';
import type { PersonaPrep } from './persona-prep';
import { PROVIDER_ACCOUNT_COLUMNS } from './account-columns';

export const ExperimentLinkSchema = z
  .object({
    experimentId: z.string().uuid(),
    variantId: z.string().regex(EXPERIMENT_VARIANT_ID_PATTERN),
    pair: z.number().int().min(1).max(EXPERIMENT_TARGET_PAIRS_MAX),
  })
  .strict();

export type ExperimentLink = z.infer<typeof ExperimentLinkSchema>;

/** What a video in a pair must share with its partner. */
export interface PairFacts {
  providers: string[];
  accountIds: Record<string, string[]>;
  /** null = no Pinterest board (the video does not publish to Pinterest). */
  pinterestBoardId: string | null;
  voiceId: string | null;
  faceless: boolean;
  fullLipsync: boolean;
  segments: unknown;
  title: string;
  /** null = column default (`broll`, migration 029). */
  facelessMaterial: string | null;
  voiceAudioUrl: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
  language: string | null;
  niche: string | null;
  ctaText: string | null;
}

/** scheduled_posts.faceless_material default (migration 029). */
const DEFAULT_FACELESS_MATERIAL = 'broll';

/** Scalar settings a pair must share, in check order, with their request field. */
const SCALAR_SETTINGS: ReadonlyArray<{ field: string; label: string; read: (facts: PairFacts) => string | number | null }> = [
  { field: 'title', label: 'title', read: (facts) => facts.title },
  { field: 'options.facelessMaterial', label: 'faceless material', read: (facts) => facts.facelessMaterial ?? DEFAULT_FACELESS_MATERIAL },
  { field: 'options.audioUrl', label: 'voice audio URL', read: (facts) => facts.voiceAudioUrl },
  { field: 'options.videoAspect', label: 'video aspect', read: (facts) => facts.videoAspect },
  { field: 'options.videoLayout', label: 'video layout', read: (facts) => facts.videoLayout },
  { field: 'options.paragraphNumber', label: 'paragraph number', read: (facts) => facts.paragraphNumber },
  { field: 'options.faceQuality', label: 'face quality', read: (facts) => facts.faceQuality },
  { field: 'options.language', label: 'language', read: (facts) => facts.language },
  { field: 'options.niche', label: 'niche', read: (facts) => facts.niche },
  { field: 'options.ctaText', label: 'call to action text', read: (facts) => facts.ctaText },
];

/** The request's resolved values, exactly as the route stores them on the schedule and slot rows. */
export function buildPairFacts(input: {
  providers: string[];
  accountIds: Record<string, string[]>;
  pinterestBoardId: string | null | undefined;
  prep: PersonaPrep;
  title: string;
  segments: unknown;
  fullLipsync: boolean | undefined;
  facelessMaterial: string | undefined;
  audioUrl: string | undefined;
}): PairFacts {
  const { prep } = input;
  return {
    providers: input.providers,
    accountIds: input.accountIds,
    pinterestBoardId: input.pinterestBoardId ?? null,
    voiceId: prep.voiceIdValue ?? null,
    faceless: prep.faceless,
    fullLipsync: input.fullLipsync === true,
    segments: input.segments,
    title: input.title,
    facelessMaterial: input.facelessMaterial ?? null,
    voiceAudioUrl: input.audioUrl ?? null,
    videoAspect: prep.videoAspect,
    videoLayout: prep.videoLayout,
    paragraphNumber: prep.paragraphNumber,
    faceQuality: prep.faceQuality,
    language: prep.language,
    niche: prep.niche,
    ctaText: prep.ctaText,
  };
}

export type LinkCheck =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409 | 500; message: string; field: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with sorted keys: jsonb reorders object keys, so raw JSON differs. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function splitHook(segments: unknown): { hook: string | null; rest: unknown[] } {
  const list = Array.isArray(segments) ? segments : [];
  const hookSegment = list.find((segment) => isRecord(segment) && segment.kind === 'hook');
  return {
    hook: isRecord(hookSegment) && typeof hookSegment.text === 'string' ? hookSegment.text.trim() : null,
    rest: list.filter((segment) => !(isRecord(segment) && segment.kind === 'hook')),
  };
}

function sortedList(values: string[] | undefined): string {
  return [...(values ?? [])].sort().join(',');
}

/** The first field where this video differs from its pair partner, or null. */
export function pairMismatch(partner: PairFacts, current: PairFacts): { field: string; message: string } | null {
  if (sortedList(partner.providers) !== sortedList(current.providers)) {
    return { field: 'publishing.providers', message: 'Both videos of a pair must publish to the same providers.' };
  }
  for (const provider of current.providers) {
    if (sortedList(partner.accountIds[provider]) !== sortedList(current.accountIds[provider])) {
      return { field: `publishing.accounts.${provider}`, message: 'Both videos of a pair must publish to the same accounts.' };
    }
  }
  if ((partner.pinterestBoardId ?? null) !== (current.pinterestBoardId ?? null)) {
    return { field: 'publishing.pinterestBoardId', message: 'Both videos of a pair must publish to the same Pinterest board.' };
  }
  if (partner.voiceId !== current.voiceId) {
    return { field: 'options.voiceId', message: 'Both videos of a pair must use the same voice.' };
  }
  if (partner.faceless !== current.faceless || partner.fullLipsync !== current.fullLipsync) {
    return { field: 'options', message: 'Both videos of a pair must use the same faceless and full lip-sync settings.' };
  }
  for (const setting of SCALAR_SETTINGS) {
    if (setting.read(partner) !== setting.read(current)) {
      return { field: setting.field, message: `Both videos of a pair must use the same ${setting.label}.` };
    }
  }
  const partnerScript = splitHook(partner.segments);
  const currentScript = splitHook(current.segments);
  if (canonical(partnerScript.rest) !== canonical(currentScript.rest)) {
    return { field: 'options.segments', message: 'Only the hook may differ inside a pair: body and CTA segments must be identical.' };
  }
  if (partnerScript.hook === currentScript.hook) {
    return { field: 'options.segments', message: 'The hook must differ from the other variant in this pair.' };
  }
  return null;
}

function failure(status: 400 | 404 | 409 | 500, message: string, field: string): LinkCheck {
  return { ok: false, status, message, field };
}

export async function checkExperimentLink(
  supabase: SupabaseClient,
  input: { link: ExperimentLink; userId: string; personaId: string | null; replayScheduleId: string; facts: PairFacts },
): Promise<LinkCheck> {
  const { link, userId } = input;
  const { data: experiment, error: experimentError } = await supabase
    .from('experiments')
    .select('id, persona_id, target_pairs')
    .eq('id', link.experimentId)
    .eq('user_id', userId)
    .maybeSingle();
  if (experimentError) {
    logger.error('[generate-and-schedule] experiment lookup failed', experimentError, { experimentId: link.experimentId });
    return failure(500, 'Failed to load the experiment.', 'experiment.experimentId');
  }
  if (experiment === null) return failure(404, 'Experiment not found.', 'experiment.experimentId');
  if ((experiment.persona_id ?? null) !== input.personaId) {
    return failure(400, 'This video must use the experiment persona.', 'personaId');
  }
  if (link.pair > experiment.target_pairs) {
    return failure(400, `pair must be between 1 and ${experiment.target_pairs} for this experiment.`, 'experiment.pair');
  }

  const { data: variants, error: variantsError } = await supabase
    .from('experiment_variants')
    .select('variant_id')
    .eq('experiment_id', link.experimentId);
  if (variantsError) {
    logger.error('[generate-and-schedule] experiment variants lookup failed', variantsError, { experimentId: link.experimentId });
    return failure(500, 'Failed to load the experiment.', 'experiment.variantId');
  }
  if (!(variants ?? []).some((variant) => variant.variant_id === link.variantId)) {
    return failure(400, 'variantId is not a variant of this experiment.', 'experiment.variantId');
  }

  const { data: pairSlots, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select(PAIR_SLOT_COLUMNS)
    .eq('user_id', userId)
    .eq('experiment_id', link.experimentId)
    .eq('experiment_pair', link.pair);
  if (slotsError) {
    logger.error('[generate-and-schedule] experiment pair lookup failed', slotsError, { experimentId: link.experimentId });
    return failure(500, 'Failed to load the experiment pair.', 'experiment.pair');
  }
  const slots = pairSlots ?? [];
  const same = slots.find((slot) => slot.variant_id === link.variantId);
  // A retry with the same idempotency key addresses the same schedule:
  // the route replays it, so it is not a duplicate.
  if (same !== undefined) {
    if (same.schedule_id === input.replayScheduleId) return { ok: true };
    return failure(
      409,
      same.status === 'failed'
        ? 'The earlier video of this pair for this variant failed and its failed slot still holds the pair. Delete that slot with delete_slot if its schedule has other slots; a single-video schedule cannot be deleted that way, so use the next free pair number instead.'
        : 'This pair already has a video for this variant.',
      'experiment.variantId',
    );
  }
  const partner = slots.find((slot) => slot.variant_id !== link.variantId);
  if (partner === undefined) return { ok: true };
  return comparePartner(supabase, { link, userId, partner, facts: input.facts });
}

interface PartnerSlot {
  schedule_id: string;
  segments: unknown;
  faceless: boolean;
  full_lipsync: boolean;
  title: string;
  faceless_material: string | null;
}

const PAIR_SLOT_COLUMNS = 'schedule_id, variant_id, status, segments, faceless, full_lipsync, title, faceless_material';

async function comparePartner(
  supabase: SupabaseClient,
  input: { link: ExperimentLink; userId: string; partner: PartnerSlot; facts: PairFacts },
): Promise<LinkCheck> {
  const { link, userId, partner } = input;
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select(
      'providers, post_voice_id, post_voice_audio_url, post_video_aspect, post_video_layout, post_paragraph_number, post_face_quality, post_language, post_niche, post_cta_text, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id',
    )
    .eq('id', partner.schedule_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleError || schedule === null) {
    logger.error('[generate-and-schedule] experiment partner schedule lookup failed', scheduleError, { experimentId: link.experimentId });
    return failure(500, 'Failed to load the experiment pair.', 'experiment.pair');
  }
  const accountIds: Record<string, string[]> = {};
  for (const [provider, column] of Object.entries(PROVIDER_ACCOUNT_COLUMNS)) accountIds[provider] = schedule[column];
  const mismatch = pairMismatch(
    {
      providers: schedule.providers,
      accountIds,
      pinterestBoardId: schedule.pinterest_board_id ?? null,
      voiceId: schedule.post_voice_id,
      faceless: partner.faceless,
      fullLipsync: partner.full_lipsync,
      segments: partner.segments,
      title: partner.title,
      facelessMaterial: partner.faceless_material,
      voiceAudioUrl: schedule.post_voice_audio_url,
      videoAspect: schedule.post_video_aspect,
      videoLayout: schedule.post_video_layout,
      paragraphNumber: schedule.post_paragraph_number,
      faceQuality: schedule.post_face_quality,
      language: schedule.post_language,
      niche: schedule.post_niche,
      ctaText: schedule.post_cta_text,
    },
    input.facts,
  );
  return mismatch === null ? { ok: true } : failure(400, mismatch.message, mismatch.field);
}

/**
 * Post-insert re-check for the race where both variants of a pair were
 * validated against an empty pair. Call it once this video's slot row is
 * inserted: a partner that committed meanwhile is now visible. A failed
 * result (any status) means the caller must roll the video back.
 */
export async function verifyExperimentPairAfterInsert(
  supabase: SupabaseClient,
  input: { link: ExperimentLink; userId: string; facts: PairFacts },
): Promise<LinkCheck> {
  const { link, userId } = input;
  const { data: pairSlots, error } = await supabase
    .from('scheduled_posts')
    .select(PAIR_SLOT_COLUMNS)
    .eq('user_id', userId)
    .eq('experiment_id', link.experimentId)
    .eq('experiment_pair', link.pair);
  if (error) {
    logger.error('[generate-and-schedule] experiment pair re-check failed', error, { experimentId: link.experimentId });
    return failure(500, 'Failed to verify the experiment pair.', 'experiment.pair');
  }
  const partner = (pairSlots ?? []).find((slot) => slot.variant_id !== link.variantId);
  if (partner === undefined) return { ok: true };
  return comparePartner(supabase, { link, userId, partner, facts: input.facts });
}
