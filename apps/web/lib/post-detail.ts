import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichSlot } from './schedule-slot-presentation';
import {
  fetchEnginePostMetricsSource,
  fetchEnginePublishResults,
  fetchEngineScriptAngle,
  fetchEngineTaskProgress,
  type EngineTaskProgress,
} from './engine-tasks';
import { resolvePublishLinks, type PublishLink } from './publish-links';
import { buildGenerationFacts } from './generation-facts';
import { isPersonaAllowed, isScopedApiKey, type PersonaScopeContext } from './api-keys';
import { logger } from './logger';

//---------------
// Post detail — the shared builders behind GET /api/posts/[id] (and the
// slot detail route). One id resolves to either a scheduled slot or a
// direct video generation; both shapes carry live progress so the detail
// page never guesses which endpoint owns the id (issue #208).
//
// Ownership: every query is scoped by user_id. PGRST116 (zero rows) means
// unknown id or another user's row → null. Any other DB error throws so
// the caller can 500 (retryable) instead of 404 (terminal).
//
// Persona scope: a persona-scoped API key only sees posts of its personas
// plus persona-less posts — the same policy as GET /api/schedule/status
// and GET /api/metrics. An out-of-scope post resolves to null (404, like
// the list endpoints that never show it), and is rejected before any
// engine call.
//---------------

// The persona allow-list for a caller: null = unrestricted (web session,
// OAuth, or an unscoped key); an array = only those personas.
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
    topic: string | null;
    error: string | null;
    publishedAt: string | null;
    taskId: string | null;
    progress: number;
    stage: string | null;
    retryable: boolean | null;
    scriptAngle: string | null;
    publishLinks: PublishLink[];
    progressHistory: Array<{ progress: number; stage: string | null; recordedAt: string }>;
    queuePosition: null;
    queueTotal: null;
  };
  schedule: {
    id: string;
    personaId: string | null;
    providers: string[];
    youtubeAccountIds: string[];
    instagramAccountIds: string[];
    linkedinAccountIds: string[];
    blueskyAccountIds: string[];
    timezone: string;
    publishMode: 'scheduled' | 'asap';
  };
  persona: { id: string; name: string } | null;
  generation: {
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

//---------------
// resolvePublishedSlotEngineData — publish links and script angle for a
// published slot from ONE engine task read (fetchEnginePostMetricsSource):
// both live on the same record, so reading it twice per detail view would
// double the engine traffic on a rate-limited endpoint. A failed lookup
// degrades both to empty/null with both warnings, mirroring the separate
// resolvers below.
//---------------
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

//---------------
// resolveScriptAngle — the angle the engine built the script around, read
// from the engine task record. Cosmetic on the detail page: no task yet or
// a failed lookup degrades to null, but a failure is never silent.
//---------------
async function resolveScriptAngle(taskId: string | null, userId: string): Promise<string | null> {
  if (taskId === null || taskId.length === 0) return null;
  try {
    return await fetchEngineScriptAngle(taskId, userId);
  } catch (error) {
    logger.warn('[post-detail] script angle unavailable', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

//---------------
// getSlotPost — the full detail for a scheduled_posts id: slot row,
// schedule, persona, live engine progress, publish links, progress
// history. Null when the id is unknown, another user's, or the schedule
// row is gone (the slot without its schedule is not a post).
//---------------
export async function getSlotPost(
  supabase: SupabaseClient,
  slotId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<SlotPostDetail | null> {
  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at, status, topic, error, published_at, task_id, faceless')
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
    topic: string | null;
    error: string | null;
    published_at: string | null;
    task_id: string | null;
    faceless: boolean | null;
  };

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, timezone, post_language, post_voice_id, post_video_aspect, post_video_layout, post_niche, post_paragraph_number, post_face_quality, publish_mode')
    .eq('id', row.schedule_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  const scheduleRow = schedule as {
    id: string;
    persona_id: string | null;
    providers: string[] | null;
    youtube_account_ids: string[] | null;
    instagram_account_ids: string[] | null;
    linkedin_account_ids: string[] | null;
    bluesky_account_ids: string[] | null;
    timezone: string;
    post_language: string | null;
    post_voice_id: string | null;
    post_video_aspect: string | null;
    post_video_layout: string | null;
    post_niche: string | null;
    post_paragraph_number: number | null;
    post_face_quality: string | null;
    publish_mode: string | null;
  } | null;
  // Ownership re-check: the service client (API-key/OAuth callers)
  // bypasses RLS, so the schedule must belong to the caller.
  if (!scheduleRow) return null;
  if (!inPersonaScope(personaScope, scheduleRow.persona_id)) return null;

  // No persona is a real state (a post created without one, migration 012):
  // skip the lookup entirely rather than issuing `.eq('id', null)` and
  // logging a spurious failure on every request.
  let personaRow: { id: string; name: string } | null = null;
  if (scheduleRow.persona_id !== null) {
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id, name')
      .eq('id', scheduleRow.persona_id)
      .single();
    if (personaError && !isNotFound(personaError)) {
      // The persona name is cosmetic on the detail page — a failed lookup
      // degrades to a null persona, but never silently.
      logger.warn('[post-detail] persona lookup failed', {
        code: personaError.code,
        message: personaError.message,
      });
    }
    personaRow = persona as { id: string; name: string } | null;
  }

  const slotTaskId = typeof row.task_id === 'string' && row.task_id.length > 0 ? row.task_id : null;
  // For a live slot, progress and the script angle live on the same engine
  // task record: fetch it once here, hand it to enrichSlot (which would
  // otherwise fetch it again), and take the angle from it. A failed
  // prefetch degrades exactly like enrichSlot's own lookup (progress 0,
  // logged) — enrichSlot is told not to fetch a second time.
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
  // A published slot needs publish links AND the angle, both on the same
  // engine task record: one read serves both. Any other status needs at
  // most the angle (publish links are published-only).
  let publishLinks: PublishLink[];
  let scriptAngle: string | null;
  if (row.status === 'published' && slotTaskId !== null) {
    ({ publishLinks, scriptAngle } = await resolvePublishedSlotEngineData(slotTaskId, userId));
  } else {
    publishLinks = await resolveSlotPublishLinks(row, userId);
    // One task-record read per view: a prefetched task carries the angle,
    // and a failed prefetch already burned the view's one read — the angle
    // degrades to null instead of reading the same record a second time.
    scriptAngle =
      prefetchedTask !== undefined
        ? prefetchedTask.scriptAngle
        : prefetchFailed
          ? null
          : await resolveScriptAngle(row.task_id, userId);
  }

  // Progress history: every observed (progress, stage) transition recorded
  // while the post was live. A failed lookup degrades to an empty list —
  // the detail still resolves.
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

  // One const per leaf (not an inline object literal): v8 coverage does not
  // report object-literal property lines, so this keeps every leaf visible
  // to the coverage gate.
  const slotIdOut = row.id;
  const scheduleIdOut = row.schedule_id;
  const slotAtOut = row.slot_at;
  const statusOut = enrichment.status;
  const topicOut = row.topic;
  const errorOut = row.error;
  const publishedAtOut = row.published_at;
  const taskIdOut = row.task_id;
  const progressOut = enrichment.progress;
  const stageOut = enrichment.stage;
  const retryableOut = enrichment.retryable;
  const scheduleId2 = scheduleRow.id;
  const personaIdOut = scheduleRow.persona_id;
  const providersOut = scheduleRow.providers ?? [];
  const youtubeAccountIdsOut = scheduleRow.youtube_account_ids ?? [];
  const instagramAccountIdsOut = scheduleRow.instagram_account_ids ?? [];
  const linkedinAccountIdsOut = scheduleRow.linkedin_account_ids ?? [];
  const blueskyAccountIdsOut = scheduleRow.bluesky_account_ids ?? [];
  const timezoneOut = scheduleRow.timezone;
  const publishModeOut = scheduleRow.publish_mode === 'asap' ? 'asap' : 'scheduled';

  return {
    slot: {
      id: slotIdOut,
      scheduleId: scheduleIdOut,
      slotAt: slotAtOut,
      status: statusOut,
      topic: topicOut,
      error: errorOut,
      publishedAt: publishedAtOut,
      taskId: taskIdOut,
      progress: progressOut,
      stage: stageOut,
      retryable: retryableOut,
      scriptAngle,
      publishLinks,
      progressHistory,
      // Queue position is a list concept (position among the schedule's
      // pending slots); the detail view doesn't render it.
      queuePosition: null,
      queueTotal: null,
    },
    schedule: {
      id: scheduleId2,
      personaId: personaIdOut,
      providers: providersOut,
      youtubeAccountIds: youtubeAccountIdsOut,
      instagramAccountIds: instagramAccountIdsOut,
      linkedinAccountIds: linkedinAccountIdsOut,
      blueskyAccountIds: blueskyAccountIdsOut,
      timezone: timezoneOut,
      publishMode: publishModeOut,
    },
    persona: personaRow,
    generation: buildGenerationFacts(row, scheduleRow),
  };
}

//---------------
// getGenerationPost — one video_generations row by generation_id, with live
// engine progress while the generation is still in flight. generate-and-schedule
// writes status 'running' (and engine_task_id) once the engine accepts the
// job; 'pending' is the pre-accept snapshot and is included so a task id
// recorded before that flip still shows progress. A failed progress lookup
// degrades to 0 — the detail still resolves; the next poll retries.
//---------------
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
  // The angle lives on the same task record the progress read fetches: when
  // that read happens, the angle comes from it instead of a second read.
  // Undefined means no read was attempted (terminal generation or no task
  // id) — the angle then gets its own read below. A failed read sets it to
  // null: that attempt was this view's one read.
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
      // Transient (5xx, abort, network): degrade, keep progress 0 so the
      // next poll retries. Only a 404 is terminal, and generations never
      // settle tasks from a read path. The failed read was this view's one
      // task-record read, so the angle degrades to null with it instead of
      // reading the same record a second time.
      angleFromProgress = null;
      logger.warn('[post-detail] engine task progress unavailable', {
        taskId: row.engine_task_id,
        error: taskError instanceof Error ? taskError.message : String(taskError),
      });
    }
  }

  // One const per leaf (not an inline object literal): v8 coverage does not
  // report object-literal property lines.
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
