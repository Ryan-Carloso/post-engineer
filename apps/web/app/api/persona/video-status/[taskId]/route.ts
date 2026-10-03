import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refundTokens } from '@/lib/billing/token-check';
import { recordGenerationUpdate } from '@/lib/generation/video-generation';
import { categorizeGenerationError } from '@/lib/generation/generation-errors';
import { apiErrorResponse } from '@/lib/api-error';
import { rewriteVideoUrls, SAFE_TASK_ID } from '@/lib/video-urls';
import { taskPayload, taskState, extractTaskError } from '@/lib/engine-task-state';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/video-status/:taskId — engine status proxy.
// Keeps the Money-print URL and token on the Next server only.
// Observing a terminal state also advances the video_generations history
// row (completed, or failed with the engine error + refund flag).
//---------------

export async function GET(
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
    if (response.ok && (isFailedVideoStatus(body) || isCompletedVideoStatus(body))) {
      const supabase = createSupabaseServiceClient();
      const { data: charge } = await supabase
        .from('token_transactions')
        .select('generation_id')
        .eq('user_id', auth.userId)
        .eq('engine_task_id', taskId)
        .eq('type', 'video_generation')
        .maybeSingle();
      const generationId =
        typeof charge?.generation_id === 'string' ? charge.generation_id : undefined;
      if (!generationId) {
        return NextResponse.json(rewriteVideoUrls(body, taskId, baseUrl), { status: response.ok ? 200 : 502 });
      }
      const terminalStatus = isFailedVideoStatus(body) ? 'failed' : 'completed';
      // Repeat polls of an already-terminal task must not re-run the
      // terminal side effects: the refund RPC is idempotent, but
      // recordGenerationUpdate would re-stamp completed_at on every poll,
      // quietly turning it into "last poll time" instead of the actual
      // completion time. The only exception is a failure recorded while its
      // refund never landed — the next poll must still retry that refund.
      const { data: history } = await supabase
        .from('video_generations')
        .select('status, tokens_refunded')
        .eq('generation_id', generationId)
        .maybeSingle();
      // Review MINOR: narrow the history row explicitly — a schema change
      // that returns a non-string status (or a non-boolean flag) must not
      // silently count as a recorded terminal state. A malformed row opens
      // the gate instead of crashing it.
      const historyStatus = typeof history?.status === 'string' ? history.status : undefined;
      const tokensRefunded =
        typeof history?.tokens_refunded === 'boolean' ? history.tokens_refunded : undefined;
      const terminalRecorded =
        historyStatus === terminalStatus &&
        (terminalStatus === 'completed' || tokensRefunded === true);
      if (terminalRecorded) {
        return NextResponse.json(rewriteVideoUrls(body, taskId, baseUrl), { status: response.ok ? 200 : 502 });
      }
      if (isFailedVideoStatus(body)) {
        // Review round 5 (opencode): the refunded flag is written ONLY when
        // the refund truly landed. A failed refund leaves tokens_refunded
        // unset so the terminalRecorded gate above keeps retrying on the
        // next poll — never mark it refunded optimistically.
        const refunded = await refundTokens(supabase, auth.userId, generationId);
        if (!refunded) {
          logger.error('[api/persona/video-status] refund failed; leaving tokens_refunded unset', null, {
            generationId,
          });
        }
        const rawError = extractTaskError(body);
        await recordGenerationUpdate({
          supabase,
          generationId,
          status: 'failed',
          engineTaskId: taskId,
          errorCode: categorizeGenerationError(rawError),
          errorMessage: rawError,
          tokensRefunded: refunded ? true : undefined,
        });
      } else {
        await recordGenerationUpdate({
          supabase,
          generationId,
          status: 'completed',
          engineTaskId: taskId,
        });
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

// (rewriteVideoUrls lives in lib/video-urls.ts — shared with delete-preview.)
