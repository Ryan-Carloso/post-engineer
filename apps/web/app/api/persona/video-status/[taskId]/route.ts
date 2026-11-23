import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refundTokens } from '@/lib/billing/token-check';
import { recordGenerationUpdate } from '@/lib/generation/video-generation';
import {
  categorizeGenerationError,
  type GenerationErrorCode,
} from '@/lib/generation/generation-errors';
import { apiErrorResponse } from '@/lib/api-error';
import { rewriteVideoUrls, SAFE_TASK_ID } from '@/lib/video-urls';
import { enforceScopedTaskRead } from '@/lib/video-task-scope';
import { applyTaskPollLimit } from '@/lib/task-poll-limit';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { extractTaskError, isFailedVideoStatus, isCompletedVideoStatus } from '@/lib/engine-task-state';
import { hasPublishedSlotForTask, readDurableTaskState } from '@/lib/generation/gone-settle';
import { lookupSlotIdForTask } from '@/lib/slot-by-task';
import { postUrlFor } from '@/lib/post-url';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function getHandler(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: 'GET /api/persona/video-status' });
  }

  const { taskId } = await context.params;

  if (!SAFE_TASK_ID.test(taskId)) {
    return apiErrorResponse(400, 'Invalid taskId.', { route: 'GET /api/persona/video-status' });
  }

  const pollLimited = await applyTaskPollLimit(request, auth, taskId, RATE_LIMITS.taskStatusPoll);
  if (pollLimited) return pollLimited;

  const scopeError = await enforceScopedTaskRead(
    auth,
    taskId,
    'GET /api/persona/video-status',
    'Video task not found.',
  );
  if (scopeError) return scopeError;

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 404) {
      const supabase = createSupabaseServiceClient();
      const durable = await readDurableTaskState(supabase, auth.userId, taskId);
      let delivered: boolean = durable.complete && durable.hasVideos;
      if (!delivered) {
        const published = await hasPublishedSlotForTask(supabase, auth.userId, taskId);
        if (published === null) {
          return apiErrorResponse(502, 'Video service is unavailable.', {
            route: 'GET /api/persona/video-status',
          });
        }
        delivered = published === true;
      }
      if (!delivered && durable.errored) {
        return apiErrorResponse(502, 'Video service is unavailable.', {
          route: 'GET /api/persona/video-status',
        });
      }
      if (delivered) {
        const generationId = await lookupChargeGenerationId(supabase, auth.userId, taskId);
        const resolution = generationId ?? (await resolveGenerationIdByEngineTask(supabase, auth.userId, taskId));
        if (resolution) {
          const { data: history } = await supabase
            .from('video_generations')
            .select('status, tokens_refunded')
            .eq('generation_id', resolution)
            .maybeSingle();
          if (!terminalAlreadyRecorded(history, 'completed')) {
            await recordGenerationUpdate({
              supabase,
              generationId: resolution,
              status: 'completed',
              engineTaskId: taskId,
            });
          }
        }
        const postUrl = await resolvePostUrl(auth.userId, taskId);
        return NextResponse.json(
          {
            success: false,
            terminal: true,
            delivered: true,
            postUrl,
            error: 'The video task no longer exists on the generation engine.',
          },
          { status: 410 },
        );
      }
      await recordTerminalFailure({
        supabase,
        userId: auth.userId,
        taskId,
        rawError: taskGoneMessage(body),
        errorCode: 'engine_restart',
      });
      const failedPostUrl = await resolvePostUrl(auth.userId, taskId);
      return NextResponse.json(
        {
          success: false,
          terminal: true,
          postUrl: failedPostUrl,
          error: 'The video task no longer exists on the generation engine.',
        },
        { status: 410 },
      );
    }
    if (response.ok && (isFailedVideoStatus(body) || isCompletedVideoStatus(body))) {
      if (isFailedVideoStatus(body)) {
        const supabase = createSupabaseServiceClient();
        const rawError = extractTaskError(body);
        await recordTerminalFailure({
          supabase,
          userId: auth.userId,
          taskId,
          rawError,
          errorCode: categorizeGenerationError(rawError),
        });
      } else {
        const supabase = createSupabaseServiceClient();
        const generationId = await lookupChargeGenerationId(supabase, auth.userId, taskId);
        if (generationId) {
          const { data: history } = await supabase
            .from('video_generations')
            .select('status, tokens_refunded')
            .eq('generation_id', generationId)
            .maybeSingle();
          if (!terminalAlreadyRecorded(history, 'completed')) {
            await recordGenerationUpdate({
              supabase,
              generationId,
              status: 'completed',
              engineTaskId: taskId,
            });
          }
        }
      }
    }
    const postUrl = await resolvePostUrl(auth.userId, taskId);
    return NextResponse.json(attachPostUrl(rewriteVideoUrls(body, taskId, baseUrl), postUrl), { status: response.ok ? 200 : 502 });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-status',
      cause: error,
    });
  }
}

async function resolvePostUrl(userId: string, taskId: string): Promise<string | null> {
  try {
    const slotId = await lookupSlotIdForTask(createSupabaseServiceClient(), userId, taskId);
    return slotId === null ? null : postUrlFor(slotId);
  } catch {
    return null;
  }
}

function attachPostUrl(envelope: unknown, postUrl: string | null): unknown {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return envelope;
  const inner = (envelope as Record<string, unknown>).body;
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return envelope;
  return {
    ...(envelope as Record<string, unknown>),
    body: { ...(inner as Record<string, unknown>), postUrl },
  };
}

function taskGoneMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'task not found';
}

async function lookupChargeGenerationId(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<string | undefined> {
  const { data: charge } = await supabase
    .from('token_transactions')
    .select('generation_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .eq('type', 'video_generation')
    .maybeSingle();
  return typeof charge?.generation_id === 'string' ? charge.generation_id : undefined;
}

function terminalAlreadyRecorded(
  history: { status: unknown; tokens_refunded: unknown } | null,
  terminalStatus: 'failed' | 'completed',
): boolean {
  const historyStatus = typeof history?.status === 'string' ? history.status : undefined;
  const tokensRefunded =
    typeof history?.tokens_refunded === 'boolean' ? history.tokens_refunded : undefined;
  return (
    historyStatus === terminalStatus &&
    (terminalStatus === 'completed' || tokensRefunded === true)
  );
}

async function recordTerminalFailure(input: {
  supabase: SupabaseClient;
  userId: string;
  taskId: string;
  rawError: string | null;
  errorCode: GenerationErrorCode;
}): Promise<void> {
  const { supabase, userId, taskId, rawError, errorCode } = input;
  let generationId = await lookupChargeGenerationId(supabase, userId, taskId);
  const refundable = generationId !== undefined;
  if (!generationId) {
    generationId = await resolveGenerationIdByEngineTask(supabase, userId, taskId);
    if (!generationId) return;
  }
  const { data: history } = await supabase
    .from('video_generations')
    .select('status, tokens_refunded')
    .eq('generation_id', generationId)
    .maybeSingle();
  if (terminalAlreadyRecorded(history, 'failed')) return;
  let refunded = false;
  if (refundable) {
    refunded = await refundTokens(supabase, userId, generationId);
    if (!refunded) {
      logger.error('[api/persona/video-status] refund failed; leaving tokens_refunded unset', null, {
        generationId,
      });
    }
  }
  await recordGenerationUpdate({
    supabase,
    generationId,
    status: 'failed',
    engineTaskId: taskId,
    errorCode,
    errorMessage: rawError,
    tokensRefunded: refunded ? true : undefined,
  });
}

async function resolveGenerationIdByEngineTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('video_generations')
    .select('generation_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error('[api/persona/video-status] generation lookup by task id failed', null, {
      taskId,
      error: error.message,
    });
    return undefined;
  }
  const generationId: unknown = data?.generation_id;
  return typeof generationId === 'string' && generationId.length > 0 ? generationId : undefined;
}

export const GET = withApiErrorReporting('GET /api/persona/video-status/[taskId]', getHandler, {
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
