import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchEngineScriptAngle,
  fetchEngineTaskProgress,
} from './engine-tasks';
import { logger } from './logger';
import { isPersonaAllowed } from './api-keys';

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
  warnings: string[];
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === 'PGRST116';
}

function inPersonaScope(scope: readonly string[] | null, personaId: string | null): boolean {
  if (scope === null || personaId === null) return true;
  return isPersonaAllowed(scope, personaId);
}

async function resolveScriptAngle(
  engineTaskId: string | null,
  userId: string,
): Promise<string | null> {
  if (!engineTaskId) return null;
  try {
    return await fetchEngineScriptAngle(engineTaskId, userId);
  } catch (error) {
    logger.warn('[post-detail] engine script angle unavailable', {
      taskId: engineTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  let warnings: string[] = [];
  let angleFromProgress: string | null | undefined;
  if (row.engine_task_id) {
    const live = row.status === 'pending' || row.status === 'running';
    try {
      const task = await fetchEngineTaskProgress(row.engine_task_id, userId);
      warnings = Array.isArray(task.warnings) ? task.warnings : [];
      angleFromProgress = task.scriptAngle ?? null;
      if (live && !task.gone) {
        progress = task.progress;
        stage = task.stage;
      }
    } catch (taskError) {
      angleFromProgress = live ? null : undefined;
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
    warnings,
    scriptAngle:
      angleFromProgress !== undefined
        ? angleFromProgress
        : await resolveScriptAngle(row.engine_task_id, userId),
  };
}
