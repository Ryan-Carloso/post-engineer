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
import { hasPublishedSlotForTask, readDurableTaskState } from '@/lib/generation/gone-settle';
import { lookupSlotIdForTask } from '@/lib/slot-by-task';
import { postUrlFor } from '@/lib/post-url';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/persona/video-status/:taskId — engine status proxy.
// Keeps the Money-print URL and token on the Next server only.
// Observing a terminal state also advances the video_generations history
// row (completed, or failed with the engine error + refund flag).
// An engine 404 (the task is gone — almost always an engine restart with
// the in-memory state backend) is settled by gone-settle: delivered
// (durable COMPLETE render or a published slot) records completed and is
// never refunded; an unverifiable state answers non-terminal 502 so the
// next poll retries; only otherwise is the generation failed with
// engine_restart and the tokens refunded. Every terminal verdict answers
// 410 Gone (with delivered: true on the delivered branch) so the caller
// stops polling instead of 404ing forever.
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
      // The engine no longer serves this task. Its HTTP verdict is not
      // trusted on its own, and it may not cost the user a refund either:
      // the SAME verdict the slot-gone path applies decides here (see
      // lib/generation/gone-settle.ts):
      //   1. durable engine_task_state COMPLETE with a render → completed;
      //   2. a published scheduled_posts slot for the task → completed
      //      (delivered value — never refunded);
      //   3. only otherwise the failed+refund verdict stands.
      const supabase = createSupabaseServiceClient();
      const durable = await readDurableTaskState(supabase, auth.userId, taskId);
      let delivered: boolean = durable.complete && durable.hasVideos;
      if (!delivered) {
        const published = await hasPublishedSlotForTask(supabase, auth.userId, taskId);
        if (published === null) {
          // The published-slot read failed: the state is unverifiable, and the
          // gone-settle policy says an unverifiable state must not record a
          // terminal verdict (or a refund). Answer non-terminal; the next
          // poll retries and the billing reconcile is the eventual backstop.
          return apiErrorResponse(502, 'Video service is unavailable.', {
            route: 'GET /api/persona/video-status',
          });
        }
        delivered = published === true;
      }
      if (!delivered && durable.errored) {
        // The durable row could not be READ (not merely absent) and there is
        // no published-slot proof to consult instead: without it, "the task
        // died" is unproven, so no `failed` verdict and no refund — log and
        // answer non-terminal for the next poll to retry.
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
        // The 410 body carries delivered: true so a caller that only sees
        // the status (e.g. the MCP wait tool) can tell a finished video
        // apart from a failed one — both answer 410 with the same message.
        // postUrl names the delivered post's detail page (issue #555).
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
      // Nothing proves the video finished: the historical failed verdict
      // stands (failed with engine_restart and refund, exactly like a
      // numeric failed state; 410 tells the caller to stop polling).
      await recordTerminalFailure({
        supabase,
        userId: auth.userId,
        taskId,
        rawError: taskGoneMessage(body),
        errorCode: 'engine_restart',
      });
      // The failed slot's detail page is still a valid link (issue #555).
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
    // The slot link rides on every status read (issue #555): the agent can
    // send the detail link as soon as the video exists, and the slot exists
    // from scheduling time — not only once the render finishes. A missing
    // slot (direct generation) or a failed lookup answers postUrl null.
    const postUrl = await resolvePostUrl(auth.userId, taskId);
    return NextResponse.json(attachPostUrl(rewriteVideoUrls(body, taskId, baseUrl), postUrl), { status: response.ok ? 200 : 502 });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-status',
      cause: error,
    });
  }
}

//---------------
// resolvePostUrl — the slot's absolute detail link for one engine task,
// or null when the task has no slot (direct generation), the lookup
// fails, or the public app URL is not configured. A failure anywhere
// (including service-client construction) degrades to null: the status
// itself still resolves, and the next poll retries.
//---------------
async function resolvePostUrl(userId: string, taskId: string): Promise<string | null> {
  try {
    const slotId = await lookupSlotIdForTask(createSupabaseServiceClient(), userId, taskId);
    return slotId === null ? null : postUrlFor(slotId);
  } catch {
    return null;
  }
}

//---------------
// attachPostUrl — postUrl inside the envelope's body (issue #555), where
// BaseResponse readers look: the MCP narrows result.body, so a top-level
// postUrl on the envelope would never reach get_video_task_progress or
// wait_for_video_tasks. A non-envelope body (a bare string, an array, or
// an envelope without an object body) passes through untouched.
//---------------
function attachPostUrl(envelope: unknown, postUrl: string | null): unknown {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return envelope;
  const inner = (envelope as Record<string, unknown>).body;
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return envelope;
  return {
    ...(envelope as Record<string, unknown>),
    body: { ...(inner as Record<string, unknown>), postUrl },
  };
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
  let generationId = await lookupChargeGenerationId(supabase, userId, taskId);
  // No charge row carries this task id. That is the NORMAL case for a
  // scheduled post: batch tokens are prepaid once under `batch:<schedule_id>`
  // (engine_task_id NULL) while each slot dispatches its own task, so this
  // lookup can only ever match a direct generation.
  //
  // Returning early here used to strand every scheduled post in `running`
  // forever: the caller got its 410 and stopped polling, but the history row
  // was never advanced. Fall back to the task-id link on the generation row
  // itself so the terminal state is still recorded.
  //
  // NO REFUND on this path — there is no per-generation charge to refund, and
  // a batch charge covers sibling slots. The billing reconciliation cron owns
  // that decision.
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
    // Only ever set the flag when a refund was actually attempted and
    // landed. tokens_refunded gates the retry backstop, so writing it for a
    // path that never refunded would silence the retry forever.
    tokensRefunded: refunded ? true : undefined,
  });
}

//---------------
// resolveGenerationIdByEngineTask — the task_id → generation link that works
// for scheduled posts, whose charge row carries no engine_task_id.
//---------------
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

// (rewriteVideoUrls lives in lib/video-urls.ts — shared with delete-preview.)

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/video-status/[taskId]', getHandler, {
  // Polling route: a success event per poll is noise; 4xx/5xx still report.
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
