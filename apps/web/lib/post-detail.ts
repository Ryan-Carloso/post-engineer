import type { SupabaseClient } from '@supabase/supabase-js';
import { commentWarningsFromOutcomes, type FirstCommentOutcomeWarning } from './first-comment/outcome-warnings';
import { resolvePublishLinks, type PublishLink } from './publish-links';
import { buildScheduleDetail, type ScheduleDetailRow } from './post-detail-schedule';
import { noticesFromOutcomes, type PublishProviderFailure, type PublishUserNotice } from './publish-user-notice';
import { isPersonaAllowed, isScopedApiKey, type PersonaScopeContext } from './api-keys';
import { logger } from './logger';
import { postUrlFor } from './post-url';
import { readPostPromptFacts } from './prompt-versions';
import type { PostPromptFacts } from './slot-detail';
import { createSupabaseServiceClient } from './supabase/service';
import { resolveSlotMedia } from './post-detail-media';
import type { SlotMedia } from './slot-detail';

export function personaScopeOf(auth: PersonaScopeContext): readonly string[] | null {
  return isScopedApiKey(auth) ? (auth.personaIds ?? []) : null;
}

function inPersonaScope(scope: readonly string[] | null, personaId: string | null): boolean {
  if (scope === null || personaId === null) return true;
  return isPersonaAllowed(scope, personaId);
}

export interface SlotPostDetail {
  slot: {
    id: string;
    scheduleId: string;
    slotAt: string;
    status: string;
    title: string | null;
    description: string | null;
    error: string | null;
    publishedAt: string | null;
    publishLinks: PublishLink[];
    userNotices: PublishUserNotice[];
    providerFailures: PublishProviderFailure[];
    firstComment: string | null;
    commentWarnings: FirstCommentOutcomeWarning[];
    postUrl: string | null;
    media: SlotMedia | null;
  };
  schedule: ReturnType<typeof buildScheduleDetail>;
  persona: { id: string; name: string } | null;
  prompt: PostPromptFacts | null;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === 'PGRST116';
}

export async function getSlotPost(
  supabase: SupabaseClient,
  slotId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<SlotPostDetail | null> {
  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at, status, title, description, error, published_at, publish_outcomes, prompt_version_id, media_kind, media_ref, media_content_type, first_comment')
    .eq('id', slotId)
    .eq('user_id', userId)
    .single();
  if (slotError) {
    if (isNotFound(slotError)) return null;
    throw slotError;
  }
  const row = slot as {
    id: string;
    schedule_id: string;
    slot_at: string;
    status: string;
    title: string | null;
    description: string | null;
    error: string | null;
    published_at: string | null;
    publish_outcomes: unknown;
    prompt_version_id: string | null;
    media_kind: string | null;
    media_ref: string | null;
    media_content_type: string | null;
    first_comment: string | null;
  };

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, fanvue_account_ids, telegram_account_ids, timezone, publish_mode')
    .eq('id', row.schedule_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  const scheduleRow = schedule as ScheduleDetailRow | null;
  if (!scheduleRow) return null;
  if (!inPersonaScope(personaScope, scheduleRow.persona_id)) return null;

  let personaRow: { id: string; name: string } | null = null;
  if (scheduleRow.persona_id !== null) {
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id, name')
      .eq('id', scheduleRow.persona_id)
      .single();
    if (personaError && !isNotFound(personaError)) {
      logger.warn('[post-detail] persona lookup failed', {
        code: personaError.code,
        message: personaError.message,
      });
    }
    personaRow = persona as { id: string; name: string } | null;
  }

  const promptVersionId = row.prompt_version_id ?? null;
  const prompt =
    promptVersionId === null ? null : await readPostPromptFacts(createSupabaseServiceClient(), promptVersionId);

  const publishNotices = noticesFromOutcomes(row.publish_outcomes);
  const media =
    row.media_kind === 'upload' || row.media_kind === 'image'
      ? await resolveSlotMedia(createSupabaseServiceClient(), row.id, userId, row)
      : null;

  return {
    slot: {
      id: row.id,
      scheduleId: row.schedule_id,
      slotAt: row.slot_at,
      status: row.status,
      title: row.title,
      description: row.description,
      error: row.error,
      publishedAt: row.published_at,
      postUrl: postUrlFor(row.id),
      media,
      publishLinks: row.status === 'published' ? resolvePublishLinks(row.publish_outcomes) : [],
      userNotices: publishNotices.userNotices,
      providerFailures: publishNotices.providerFailures,
      firstComment: row.first_comment ?? null,
      commentWarnings: commentWarningsFromOutcomes(row.publish_outcomes),
    },
    schedule: buildScheduleDetail(scheduleRow),
    persona: personaRow,
    prompt,
  };
}
