import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichSlot } from './schedule-slot-presentation';
import { hookPhotoForSegments, type HookPhoto } from './hook-photo';
import {
  fetchEnginePostMetricsSource,
  fetchEnginePublishResults,
  fetchEngineTaskProgress,
  type EngineTaskProgress,
} from './engine-tasks';
import { resolvePublishLinks, type PublishLink } from './publish-links';
import { buildScheduleDetail, type ScheduleDetailRow } from './post-detail-schedule';
import { resolveScriptAngle } from './post-detail-script-angle';
import { noticesFromOutcomes, type PublishProviderFailure, type PublishUserNotice } from './publish-user-notice';
import { buildGenerationFacts } from './generation-facts';
import { readPostPromptFacts } from './prompt-versions';
import type { PostPromptFacts } from './slot-detail';
import { isPersonaAllowed, isScopedApiKey, type PersonaScopeContext } from './api-keys';
import { logger } from './logger';
import { postUrlFor } from './post-url';

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
    error: string | null;
    publishedAt: string | null;
    taskId: string | null;
    progress: number;
    stage: string | null;
    retryable: boolean | null;
    scriptAngle: string | null;
    publishLinks: PublishLink[];
    progressHistory: Array<{ progress: number; stage: string | null; recordedAt: string }>;
    userNotices: PublishUserNotice[];
    providerFailures: PublishProviderFailure[];
    queuePosition: null;
    queueTotal: null;
    postUrl: string | null;
    hookPhoto: HookPhoto;
  };
  schedule: {
    id: string;
    personaId: string | null;
    providers: string[];
    youtubeAccountIds: string[];
    instagramAccountIds: string[];
    linkedinAccountIds: string[];
    blueskyAccountIds: string[];
    threadsAccountIds: string[];
    facebookAccountIds: string[];
    pinterestAccountIds: string[];
    pinterestBoardId: string | null;
    threespeakAccountIds: string[];
    rumbleAccountIds: string[];
    fanvueAccountIds: string[];
    telegramAccountIds: string[];
    timezone: string;
    publishMode: 'scheduled' | 'asap';
  };
  persona: { id: string; name: string } | null;
  generation: {
    prompt: PostPromptFacts | null;
    faceless: boolean;
    language: string | null;
    voiceId: string | null;
    videoAspect: string | null;
    videoLayout: string | null;
    niche: string | null;
    paragraphNumber: number | null;
    faceQuality: string | null;
  };
}

export interface GenerationPostDetail {
  id: string;
  generationId: string;
  engineTaskId: string | null;
  personaName: string | null;
  videoSubject: string | null;
  status: string;
  errorCode: string | null;
  tokensRefunded: boolean;
  createdAt: string;
  completedAt: string | null;
  progress: number;
  stage: string | null;
  scriptAngle: string | null;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === 'PGRST116';
}

async function resolveSlotPublishLinks(
  row: { status?: unknown; task_id?: unknown },
  userId: string,
): Promise<PublishLink[]> {
  if (row.status !== 'published') return [];
  const taskId = typeof row.task_id === 'string' ? row.task_id : null;
  if (taskId === null || taskId.length === 0) return [];
  try {
    return resolvePublishLinks(await fetchEnginePublishResults(taskId, userId));
  } catch (error) {
    logger.warn('[post-detail] publish results unavailable', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function resolvePublishedSlotEngineData(
  taskId: string,
  userId: string,
): Promise<{ publishLinks: PublishLink[]; scriptAngle: string | null }> {
  try {
    const source = await fetchEnginePostMetricsSource(taskId, userId);
    return { publishLinks: resolvePublishLinks(source.publishResults), scriptAngle: source.scriptAngle };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[post-detail] publish results unavailable', { taskId, error: message });
    logger.warn('[post-detail] script angle unavailable', { taskId, error: message });
    return { publishLinks: [], scriptAngle: null };
  }
}

export async function getSlotPost(
  supabase: SupabaseClient,
  slotId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<SlotPostDetail | null> {
  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at, status, title, error, published_at, task_id, faceless, publish_outcomes, segments, prompt_version_id')
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
    error: string | null;
    published_at: string | null;
    task_id: string | null;
    faceless: boolean | null;
    publish_outcomes: unknown;
    segments: unknown;
    prompt_version_id: string | null;
  };

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, fanvue_account_ids, telegram_account_ids, timezone, post_language, post_voice_id, post_video_aspect, post_video_layout, post_niche, post_paragraph_number, post_face_quality, publish_mode')
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

  const slotTaskId = typeof row.task_id === 'string' && row.task_id.length > 0 ? row.task_id : null;
  let prefetchedTask: EngineTaskProgress | undefined;
  let prefetchFailed = false;
  if ((row.status === 'generating' || row.status === 'failed') && slotTaskId !== null) {
    try {
      prefetchedTask = await fetchEngineTaskProgress(slotTaskId, userId);
    } catch (error) {
      prefetchFailed = true;
      logger.warn('[post-detail] engine task progress unavailable', {
        taskId: slotTaskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const enrichment = await enrichSlot(
    row,
    userId,
    new Map(),
    prefetchedTask !== undefined
      ? { task: prefetchedTask }
      : prefetchFailed
        ? { allowEngineLookup: false }
        : {},
  );
  let publishLinks: PublishLink[];
  let scriptAngle: string | null;
  if (row.status === 'published' && slotTaskId !== null) {
    ({ publishLinks, scriptAngle } = await resolvePublishedSlotEngineData(slotTaskId, userId));
  } else {
    publishLinks = await resolveSlotPublishLinks(row, userId);
    scriptAngle =
      prefetchedTask !== undefined
        ? prefetchedTask.scriptAngle
        : prefetchFailed
          ? null
          : await resolveScriptAngle(row.task_id, userId);
  }

  const { data: historyRows, error: historyError } = await supabase
    .from('scheduled_post_progress_history')
    .select('progress, stage, recorded_at')
    .eq('post_id', slotId)
    .eq('user_id', userId)
    .order('recorded_at', { ascending: true });
  if (historyError) {
    logger.warn('[post-detail] progress history lookup failed', {
      slotId,
      error: historyError,
    });
  }
  const progressHistory = (Array.isArray(historyRows) ? historyRows : []).map(
    (historyRow: { progress: number; stage: string | null; recorded_at: string }) => ({
      progress: historyRow.progress,
      stage: historyRow.stage,
      recordedAt: historyRow.recorded_at,
    }),
  );

  const slotIdOut = row.id;
  const scheduleIdOut = row.schedule_id;
  const slotAtOut = row.slot_at;
  const statusOut = enrichment.status;
  const titleOut = row.title;
  const errorOut = row.error;
  const publishedAtOut = row.published_at;
  const taskIdOut = row.task_id;
  const postUrlOut = postUrlFor(row.id);
  const hookPhotoOut = hookPhotoForSegments(row.segments);
  const progressOut = enrichment.progress;
  const stageOut = enrichment.stage;
  const retryableOut = enrichment.retryable;
  const publishNotices = noticesFromOutcomes(row.publish_outcomes);
  const userNoticesOut = publishNotices.userNotices;
  const providerFailuresOut = publishNotices.providerFailures;

  return {
    slot: {
      id: slotIdOut,
      scheduleId: scheduleIdOut,
      slotAt: slotAtOut,
      status: statusOut,
      title: titleOut,
      error: errorOut,
      publishedAt: publishedAtOut,
      taskId: taskIdOut,
      postUrl: postUrlOut,
      hookPhoto: hookPhotoOut,
      progress: progressOut,
      stage: stageOut,
      retryable: retryableOut,
      scriptAngle,
      publishLinks,
      progressHistory,
      queuePosition: null,
      queueTotal: null,
      userNotices: userNoticesOut,
      providerFailures: providerFailuresOut,
    },
    schedule: buildScheduleDetail(scheduleRow),
    persona: personaRow,
    generation: { prompt: await readPostPromptFacts(supabase, row.prompt_version_id ?? null), ...buildGenerationFacts(row, scheduleRow) },
  };
}

export async function getGenerationPost(
  supabase: SupabaseClient,
  generationId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<GenerationPostDetail | null> {
  const { data, error } = await supabase
    .from('video_generations')
    .select(
      'id, generation_id, engine_task_id, persona_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at',
    )
    .eq('user_id', userId)
    .eq('generation_id', generationId)
    .single();
  if (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const row = data as {
    id: string;
    generation_id: string;
    engine_task_id: string | null;
    persona_id: string | null;
    persona_name: string | null;
    video_subject: string | null;
    status: string;
    error_code: string | null;
    tokens_refunded: boolean;
    created_at: string;
    completed_at: string | null;
  };
  if (!inPersonaScope(personaScope, row.persona_id)) return null;

  let progress = 0;
  let stage: string | null = null;
  let angleFromProgress: string | null | undefined;
  if ((row.status === 'pending' || row.status === 'running') && row.engine_task_id) {
    try {
      const task = await fetchEngineTaskProgress(row.engine_task_id, userId);
      angleFromProgress = task.scriptAngle;
      if (!task.gone) {
        progress = task.progress;
        stage = task.stage;
      }
    } catch (taskError) {
      angleFromProgress = null;
      logger.warn('[post-detail] engine task progress unavailable', {
        taskId: row.engine_task_id,
        error: taskError instanceof Error ? taskError.message : String(taskError),
      });
    }
  }

  const idOut = row.id;
  const generationIdOut = row.generation_id;
  const engineTaskIdOut = row.engine_task_id;
  const personaNameOut = row.persona_name;
  const videoSubjectOut = row.video_subject;
  const statusOut = row.status;
  const errorCodeOut = row.error_code;
  const tokensRefundedOut = row.tokens_refunded === true;
  const createdAtOut = row.created_at;
  const completedAtOut = row.completed_at;

  return {
    id: idOut,
    generationId: generationIdOut,
    engineTaskId: engineTaskIdOut,
    personaName: personaNameOut,
    videoSubject: videoSubjectOut,
    status: statusOut,
    errorCode: errorCodeOut,
    tokensRefunded: tokensRefundedOut,
    createdAt: createdAtOut,
    completedAt: completedAtOut,
    progress,
    stage,
    scriptAngle:
      angleFromProgress !== undefined
        ? angleFromProgress
        : await resolveScriptAngle(row.engine_task_id, userId),
  };
}
