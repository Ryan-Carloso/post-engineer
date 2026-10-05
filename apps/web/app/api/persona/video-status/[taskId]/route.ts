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
import { taskPayload, taskState, extractTaskError } from '@/lib/engine-task-state';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// GET /api/persona/video-status/:taskId — engine status proxy.
// Keeps the Money-print URL and token on the Next server only.
// Observing a terminal state also advances the video_generations history
// row (completed, or failed with the engine error + refund flag).
// An engine 404 (the task is gone — almost always an engine restart with
// the in-memory state backend) is terminal too: the generation is failed
// with engine_restart and the tokens refunded, and the caller gets
// 410 Gone so it stops polling instead of 404ing forever.
//---------------

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

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 404) {
      // The engine no longer knows this task — polling again will 404
      // forever, so this is terminal: fail the generation with
      // engine_restart and refund, exactly like a numeric failed state.
      // 410 Gone tells the caller to stop polling.
      const supabase = createSupabaseServiceClient();
      await recordTerminalFailure({
        supabase,
        userId: auth.userId,
        taskId,
        rawError: taskGoneMessage(body),
        errorCode: 'engine_restart',
      });
      return NextResponse.json(
        {
          success: false,
          terminal: true,
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
          // Repeat polls of an already-terminal task must not re-run the
          // terminal side effects: recordGenerationUpdate would re-stamp
          // completed_at on every poll, quietly turning it into "last poll
          // time" instead of the actual completion time.
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
    return NextResponse.json(rewriteVideoUrls(body, taskId, baseUrl), { status: response.ok ? 200 : 502 });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-status',
      cause: error,
    });
  }
}

//---------------
// Terminal-state detection — shared parsing lives in
// lib/engine-task-state; the string-status fallback below stays here
// because only this proxy honors non-numeric shapes.
//---------------
function hasStringState(task: Record<string, unknown>, values: string[]): boolean {
  return [task.status, task.task_status].some(
    (candidate) =>
      typeof candidate === 'string' && values.includes(candidate.toLowerCase()),
  );
}

function isFailedVideoStatus(value: unknown): boolean {
  const task = taskPayload(value);
  if (!task) return false;
  const state = taskState(task);
  if (state !== null) return state === -1;
  return hasStringState(task, ['failed', 'failure', 'error']);
}

function isCompletedVideoStatus(value: unknown): boolean {
  const task = taskPayload(value);
  if (!task) return false;
  const state = taskState(task);
  if (state !== null) return state === 1;
  return hasStringState(task, ['completed', 'complete', 'done', 'success']);
}

//---------------
// taskGoneMessage — the engine's 404 body is { status, message } where the
// message carries the request id ("<request_id>: task not found"). Keep the
// raw text for the history row (same as the numeric failed path keeps the
// raw engine error); fall back to a plain sentence when the shape is off.
//---------------
function taskGoneMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'task not found';
}

//---------------
// lookupChargeGenerationId — the token_transactions row that links an
// engine task to the web-side generation (and proves tokens were spent).
// None means nothing was charged for this task (e.g. a ghost task id),
// so there is nothing to refund or record.
//---------------
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

//---------------
// terminalAlreadyRecorded — idempotency gate shared by every terminal
// observation. A schema change that returns a non-string status (or a
// non-boolean flag) must not silently count as a recorded terminal state:
// a malformed row opens the gate instead of crashing it. The only
// exception is a failure recorded while its refund never landed — the
// next poll must still retry that refund, so a failed-but-unrefunded row
// is NOT terminal yet.
//---------------
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

//---------------
// recordTerminalFailure — shared failed-path side effects for every
// terminal failure observation (numeric state -1, engine 404).
// Looks up the charge row, skips already-recorded failures, refunds via
// the idempotent RPC, and marks the generation failed.
//
// Review round 5 (opencode): the refunded flag is written ONLY when the
// refund truly landed. A failed refund leaves tokens_refunded unset so
// the gate above keeps retrying on the next poll — never mark it
// refunded optimistically.
//---------------
async function recordTerminalFailure(input: {
  supabase: SupabaseClient;
  userId: string;
  taskId: string;
  rawError: string | null;
  errorCode: GenerationErrorCode;
}): Promise<void> {
  const { supabase, userId, taskId, rawError, errorCode } = input;
  const generationId = await lookupChargeGenerationId(supabase, userId, taskId);
  if (!generationId) return;
  const { data: history } = await supabase
    .from('video_generations')
    .select('status, tokens_refunded')
    .eq('generation_id', generationId)
    .maybeSingle();
  if (terminalAlreadyRecorded(history, 'failed')) return;
  const refunded = await refundTokens(supabase, userId, generationId);
  if (!refunded) {
    logger.error('[api/persona/video-status] refund failed; leaving tokens_refunded unset', null, {
      generationId,
    });
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

// (rewriteVideoUrls lives in lib/video-urls.ts — shared with delete-preview.)

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/video-status/[taskId]', getHandler);
