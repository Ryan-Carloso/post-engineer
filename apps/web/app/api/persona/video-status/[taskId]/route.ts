import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refundTokens } from '@/lib/billing/token-check';
import { recordGenerationUpdate } from '@/lib/generation/video-generation';
import { categorizeGenerationError } from '@/lib/generation/generation-errors';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/video-status/:taskId — engine status proxy.
// Keeps the Money-print URL and token on the Next server only.
// Observing a terminal state also advances the video_generations history
// row (completed, or failed with the engine error + refund flag).
//---------------

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: 'MONEYPRINT_API_URL is not defined' }, { status: 500 });
  }

  const { taskId } = await context.params;

  if (!SAFE_TASK_ID.test(taskId)) {
    return NextResponse.json({ success: false, error: 'Invalid taskId.' }, { status: 400 });
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
        await refundTokens(supabase, auth.userId, generationId);
        const rawError = extractTaskError(body);
        await recordGenerationUpdate({
          supabase,
          generationId,
          status: 'failed',
          engineTaskId: taskId,
          errorCode: categorizeGenerationError(rawError),
          errorMessage: rawError,
          tokensRefunded: true,
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
    logger.error('[api/persona/video-status] upstream unavailable', error);
    return NextResponse.json({ success: false, error: 'Video service is unavailable.' }, { status: 502 });
  }
}

//---------------
// Terminal-state detection — the engine wraps the task under `data` and
// reports progress as a numeric `state` (-1 failed, 1 complete, 3 queued,
// 4 processing), alongside a string `status` like "publishing". Some shapes
// only carry a string status, so both are recognized. The numeric state
// wins when present because the string status is not terminal-oriented.
//---------------
function taskPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (typeof data === 'object' && data !== null) {
    return data as Record<string, unknown>;
  }
  return record;
}

function taskState(task: Record<string, unknown>): number | null {
  for (const candidate of [task.state, task.task_state]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^-?\d+$/.test(candidate.trim())) {
      return parseInt(candidate.trim(), 10);
    }
  }
  return null;
}

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
// extractTaskError — the engine stores the failure reason in the task's
// `error` field; the status proxy passes it through. Returns null when the
// body carries no usable error text.
//---------------
function extractTaskError(value: unknown): string | null {
  const task = taskPayload(value);
  if (!task) return null;
  const candidate = task.error;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function rewriteVideoUrls(body: unknown, taskId: string, baseUrl: string): unknown {
  if (typeof body === 'string') {
    let candidate = body;
    let internalAbsolute = false;
    try {
      const absolute = new URL(body);
      if (absolute.origin === new URL(baseUrl).origin) {
        candidate = `${absolute.pathname}${absolute.search}`;
        internalAbsolute = true;
      }
    } catch {
      // Non-URL strings are ordinary status data.
    }
    const relative = candidate.match(/^\/api\/v1\/(download|stream)\/([^?]+)(\?.*)?$/);
    if (relative) {
      const path = relative[2].split('/');
      if (path[0] === taskId) path.shift();
      if (path.length === 0) return body;
      return `/api/persona/video-download/${encodeURIComponent(taskId)}/${path.map(encodeURIComponent).join('/')}${relative[1] === 'stream' ? '?source=stream' : ''}`;
    }
    return internalAbsolute ? null : body;
  }
  if (Array.isArray(body)) return body.map((item) => rewriteVideoUrls(item, taskId, baseUrl));
  if (typeof body !== 'object' || body === null) return body;
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, rewriteVideoUrls(value, taskId, baseUrl)]));
}
