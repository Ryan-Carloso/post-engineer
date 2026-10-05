import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { engineAuthHeaders } from '@/lib/request-auth';
import { checkAndDeductTokens, refundTokens } from '@/lib/billing/token-check';
import type { FaceQuality } from '@/lib/tokens';
import { logger } from '@/lib/logger';

//---------------
// Shared video-generation core — used by the unified generate+schedule
// flow (/api/videos/generate-and-schedule): token gate, engine task
// creation, refunds. One implementation serves every caller, so
// moderation → token charging → task creation is always identical.
//---------------

export interface GenerationGateInput {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  /** Per-post "no face" choice — prices the video (faceless is the flat rate). */
  faceless: boolean;
  faceQuality: FaceQuality;
}

export type GenerationGateResult =
  | { ok: true; cost: number }
  | { ok: false; response: NextResponse };

//---------------
// gateGeneration — validates and reserves tokens before creating the engine task.
//---------------
export async function gateGeneration(input: GenerationGateInput): Promise<GenerationGateResult> {
  const tokenResult = await checkAndDeductTokens(
    input.supabase,
    input.userId,
    input.generationId,
    input.faceless,
    input.faceQuality,
  );
  if (!tokenResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: tokenResult.error,
          code: tokenResult.freeExhausted ? 'FREE_EXHAUSTED' : 'INSUFFICIENT',
        },
        { status: tokenResult.statusCode },
      ),
    };
  }
  return { ok: true, cost: tokenResult.cost };
}

export type EngineTaskResult =
  | { ok: true; taskId?: string; body: unknown }
  | { ok: false; response: NextResponse; upstreamStatus?: number; upstreamBody?: unknown };

//---------------
// startEngineVideoTask — POST /api/v1/videos on money-print.
// Returns the raw body; each route normalizes the taskId to its own format.
//---------------
export async function startEngineVideoTask(
  userId: string,
  payload: object,
): Promise<EngineTaskResult> {
  const rawUrl = process.env.MONEYPRINT_API_URL;
  if (!rawUrl) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'MONEYPRINT_API_URL is not defined' },
        { status: 500 },
      ),
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${rawUrl.replace(/\/+$/, '')}/api/v1/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...engineAuthHeaders(userId),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error('[generation] engine unreachable', error);
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Video service is unavailable.' },
        { status: 502 },
      ),
    };
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    logger.error('[generation] engine error', undefined, { status: upstream.status, body });
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Video service rejected the job.' },
        { status: 502 },
      ),
      upstreamStatus: upstream.status,
      upstreamBody: body,
    };
  }

  return { ok: true, taskId: extractTaskId(body), body };
}

export async function refundFailedGeneration(
  supabase: SupabaseClient,
  userId: string,
  generationId: string,
): Promise<void> {
  await refundTokens(supabase, userId, generationId);
}

export async function attachGenerationTask(
  supabase: SupabaseClient,
  generationId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('token_transactions')
    .update({ engine_task_id: taskId })
    .eq('generation_id', generationId)
    .eq('type', 'video_generation');

  if (error) {
    logger.error('[generation] failed to attach engine task', error, { generationId, taskId });
  }
}

//---------------
// uploadEngineTempAsset — uploads a debug-flow input file (photo/voice)
// to the engine's TEMPORARY storage (storage/temp_assets, 1h TTL). Nothing
// is persisted in Supabase: the file disappears on its own after the
// generation. Returns the public URL the engine can download.
//---------------
export async function uploadEngineTempAsset(
  userId: string,
  file: File,
  extension: string,
): Promise<string | undefined> {
  const rawUrl = process.env.MONEYPRINT_API_URL;
  if (!rawUrl) {
    logger.error('[generation] MONEYPRINT_API_URL is not defined');
    return undefined;
  }

  const formData = new FormData();
  formData.append('file', file, `asset.${extension}`);

  let upstream: Response;
  try {
    upstream = await fetch(`${rawUrl.replace(/\/+$/, '')}/api/v1/temp_assets`, {
      method: 'POST',
      headers: engineAuthHeaders(userId),
      body: formData,
    });
  } catch (error) {
    logger.error('[generation] engine unreachable for temp asset upload', error);
    return undefined;
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    logger.error('[generation] temp asset upload failed', undefined, { status: upstream.status, body });
    return undefined;
  }

  if (typeof body !== 'object' || body === null) return undefined;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const url = (data as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

//---------------
// extractTaskId — the money-print response follows the
// { status, body: { task_id } } shape; tolerant extraction.
//---------------
function extractTaskId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const payload = (body as { body?: unknown }).body;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const taskId = (payload as { task_id?: unknown }).task_id;
  return typeof taskId === 'string' ? taskId : undefined;
}

export type GenerationHistoryStatus = 'pending' | 'running' | 'completed' | 'failed';

//---------------
// recordGenerationStart — inserts the video_generations row right after the
// token gate passes. The row is a snapshot (denormalized persona name and
// subject) so the History page can render it even if the persona is later
// renamed or deleted. Never throws: history recording must not break the
// generation itself.
//---------------
export interface RecordGenerationStartInput {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  personaId?: string | null;
  personaName?: string | null;
  videoSubject?: string | null;
}

export async function recordGenerationStart(input: RecordGenerationStartInput): Promise<void> {
  try {
    const { error } = await input.supabase.from('video_generations').insert({
      user_id: input.userId,
      generation_id: input.generationId,
      persona_id: input.personaId ?? null,
      persona_name: input.personaName ?? null,
      video_subject: input.videoSubject ?? null,
      status: 'pending',
    });
    if (error) {
      logger.error('[generation] failed to record generation start', error, { generationId: input.generationId });
    }
  } catch (error) {
    logger.error('[generation] failed to record generation start', error, { generationId: input.generationId });
  }
}

//---------------
// recordGenerationUpdate — advances the video_generations row (engine task
// attached, terminal state observed, engine rejected the job). Terminal
// states stamp completed_at. Never throws.
//---------------
export interface RecordGenerationUpdateInput {
  supabase: SupabaseClient;
  generationId: string;
  status: Exclude<GenerationHistoryStatus, 'pending'>;
  engineTaskId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  tokensRefunded?: boolean;
}

export async function recordGenerationUpdate(input: RecordGenerationUpdateInput): Promise<void> {
  const terminal = input.status === 'completed' || input.status === 'failed';
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.engineTaskId !== undefined) patch.engine_task_id = input.engineTaskId;
  if (input.errorCode !== undefined) patch.error_code = input.errorCode;
  if (input.errorMessage !== undefined) patch.error_message = input.errorMessage;
  if (input.tokensRefunded !== undefined) patch.tokens_refunded = input.tokensRefunded;
  if (terminal) patch.completed_at = new Date().toISOString();
  try {
    const { error } = await input.supabase
      .from('video_generations')
      .update(patch)
      .eq('generation_id', input.generationId);
    if (error) {
      logger.error('[generation] failed to record generation update', error, { generationId: input.generationId, status: input.status });
    }
  } catch (error) {
    logger.error('[generation] failed to record generation update', error, { generationId: input.generationId, status: input.status });
  }
}
