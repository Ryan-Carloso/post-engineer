//---------------
// Experiment link for POST /api/videos/generate-and-schedule (issue #476).
// A video can join a paired A/B experiment: `experiment: { experimentId,
// variantId, pair }`. Everything here runs BEFORE the charge, so a bad link
// never costs tokens.
//
// Fairness is checked per pair: when the other variant's video of the same
// pair already exists, this video must match it in everything except the
// hook — providers, accounts, voice, faceless, full lip-sync and every
// non-hook segment — and its hook must differ. Persona is checked against
// the experiment for every video.
//
// Service role bypasses RLS: every query filters by user_id explicitly.
//---------------

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { EXPERIMENT_TARGET_PAIRS_MAX, EXPERIMENT_VARIANT_ID_PATTERN } from '@/lib/experiments/limits';
import { logger } from '@/lib/logger';

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
  voiceId: string | null;
  faceless: boolean;
  fullLipsync: boolean;
  segments: unknown;
}

export type LinkCheck =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409 | 500; message: string; field: string };

const PROVIDER_ACCOUNT_COLUMNS = {
  youtube: 'youtube_account_ids',
  instagram: 'instagram_account_ids',
  linkedin: 'linkedin_account_ids',
  bluesky: 'bluesky_account_ids',
  threads: 'threads_account_ids',
} as const;

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
  if (partner.voiceId !== current.voiceId) {
    return { field: 'options.voiceId', message: 'Both videos of a pair must use the same voice.' };
  }
  if (partner.faceless !== current.faceless || partner.fullLipsync !== current.fullLipsync) {
    return { field: 'options', message: 'Both videos of a pair must use the same faceless and full lip-sync settings.' };
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
    .select('schedule_id, variant_id, segments, faceless, full_lipsync')
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
    return same.schedule_id === input.replayScheduleId
      ? { ok: true }
      : failure(409, 'This pair already has a video for this variant.', 'experiment.variantId');
  }
  const partner = slots.find((slot) => slot.variant_id !== link.variantId);
  if (partner === undefined) return { ok: true };

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('providers, post_voice_id, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids')
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
      voiceId: schedule.post_voice_id,
      faceless: partner.faceless,
      fullLipsync: partner.full_lipsync,
      segments: partner.segments,
    },
    input.facts,
  );
  return mismatch === null ? { ok: true } : failure(400, mismatch.message, mismatch.field);
}
