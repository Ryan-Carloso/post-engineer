import type { SupabaseClient } from '@supabase/supabase-js';

import { ExperimentLinkSchema, type ExperimentLink } from '@/lib/contracts/videos';

export { ExperimentLinkSchema, type ExperimentLink };

import { logger } from '@/lib/logger';
import { isVideoType, type VideoType } from '@/lib/tokens';
import type { PersonaPrep } from './persona-prep';
import { PROVIDER_ACCOUNT_COLUMNS } from './account-columns';
import { recordExperimentVideoLinked } from './experiment-link-telemetry';


export interface PairFacts {
  providers: string[];
  accountIds: Record<string, string[]>;
  pinterestBoardId: string | null;
  voiceId: string | null;
  videoType: VideoType;
  segments: unknown;
  title: string;
  voiceAudioUrl: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
  language: string | null;
  niche: string | null;
  ctaText: string | null;
}

const SCALAR_SETTINGS: ReadonlyArray<{ field: string; label: string; read: (facts: PairFacts) => string | number | null }> = [
  { field: 'title', label: 'title', read: (facts) => facts.title },
  { field: 'options.audioUrl', label: 'voice audio URL', read: (facts) => facts.voiceAudioUrl },
  { field: 'options.videoAspect', label: 'video aspect', read: (facts) => facts.videoAspect },
  { field: 'options.videoLayout', label: 'video layout', read: (facts) => facts.videoLayout },
  { field: 'options.paragraphNumber', label: 'paragraph number', read: (facts) => facts.paragraphNumber },
  { field: 'options.faceQuality', label: 'face quality', read: (facts) => facts.faceQuality },
  { field: 'options.language', label: 'language', read: (facts) => facts.language },
  { field: 'options.niche', label: 'niche', read: (facts) => facts.niche },
  { field: 'options.ctaText', label: 'call to action text', read: (facts) => facts.ctaText },
];

export function buildPairFacts(input: {
  providers: string[];
  accountIds: Record<string, string[]>;
  pinterestBoardId: string | null | undefined;
  prep: PersonaPrep;
  title: string;
  segments: unknown;
  videoType: VideoType;
  audioUrl: string | undefined;
}): PairFacts {
  const { prep } = input;
  return {
    providers: input.providers,
    accountIds: input.accountIds,
    pinterestBoardId: input.pinterestBoardId ?? null,
    voiceId: prep.voiceIdValue ?? null,
    videoType: input.videoType,
    segments: input.segments,
    title: input.title,
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
  if (partner.videoType !== current.videoType) {
    return { field: 'options.videoType', message: 'Both videos of a pair must use the same video type.' };
  }
  for (const setting of SCALAR_SETTINGS) {
    if (setting.read(partner) !== setting.read(current)) {
      return { field: setting.field, message: `Both videos of a pair must use the same ${setting.label}.` };
    }
  }
  const partnerScript = splitHook(partner.segments);
  const currentScript = splitHook(current.segments);
  if (canonical(partnerScript.rest) !== canonical(currentScript.rest)) {
    return { field: 'options.segments', message: 'Only the hook may differ inside a pair: content segments must be identical.' };
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
  if (same !== undefined) {
    if (same.schedule_id === input.replayScheduleId) return { ok: true };
    return failure(
      409,
      same.status === 'failed'
        ? 'The earlier video of this pair for this variant failed and its failed slot still holds the pair. Delete that slot with schedules (action: delete_slot) if its schedule has other slots; a single-video schedule cannot be deleted that way, so use the next free pair number instead.'
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
  video_type: string;
  title: string;
}

const PAIR_SLOT_COLUMNS = 'schedule_id, variant_id, status, segments, video_type, title';

async function comparePartner(
  supabase: SupabaseClient,
  input: { link: ExperimentLink; userId: string; partner: PartnerSlot; facts: PairFacts },
): Promise<LinkCheck> {
  const { link, userId, partner } = input;
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select(
      'providers, post_voice_id, post_voice_audio_url, post_video_aspect, post_video_layout, post_paragraph_number, post_face_quality, post_language, post_niche, post_cta_text, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, fanvue_account_ids',
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
  if (!isVideoType(partner.video_type)) {
    logger.error('[generate-and-schedule] experiment partner slot has an unknown video_type', undefined, { experimentId: link.experimentId });
    return failure(500, 'Failed to load the experiment pair.', 'experiment.pair');
  }
  const mismatch = pairMismatch(
    {
      providers: schedule.providers,
      accountIds,
      pinterestBoardId: schedule.pinterest_board_id ?? null,
      voiceId: schedule.post_voice_id,
      videoType: partner.video_type,
      segments: partner.segments,
      title: partner.title,
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

function bothVariantsSlotted(slots: ReadonlyArray<{ variant_id: string }>, variantId: string): boolean {
  let hasSelf = false;
  let hasOther = false;
  for (const slot of slots) {
    if (slot.variant_id === variantId) hasSelf = true;
    else hasOther = true;
  }
  return hasSelf && hasOther;
}

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
  const slots = pairSlots ?? [];
  const partner = slots.find((slot) => slot.variant_id !== link.variantId);
  if (partner !== undefined) {
    const compared = await comparePartner(supabase, { link, userId, partner, facts: input.facts });
    if (!compared.ok) return compared;
  }
  recordExperimentVideoLinked({
    userId,
    experimentId: link.experimentId,
    variantId: link.variantId,
    pair: link.pair,
    faceless: input.facts.videoType === 'faceless',
    pairComplete: bothVariantsSlotted(slots, link.variantId),
  });
  return { ok: true };
}
