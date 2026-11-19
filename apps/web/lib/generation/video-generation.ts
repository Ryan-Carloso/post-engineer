import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { engineAuthHeaders } from '@/lib/request-auth';
import { refundTokens } from '@/lib/billing/token-check';
import { logger } from '@/lib/logger';

export type EngineTaskResult =
  | { ok: true; taskId?: string; body: unknown }
  | { ok: false; response: NextResponse; upstreamStatus?: number; upstreamBody?: unknown };

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
  const payload = (body as { body?: unknown }).body;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const url = (payload as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

function extractTaskId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const payload = (body as { body?: unknown }).body;
  if (typeof payload !== 'object' || payload === null) return undefined;
  const taskId = (payload as { task_id?: unknown }).task_id;
  return typeof taskId === 'string' ? taskId : undefined;
}

export type GenerationHistoryStatus = 'pending' | 'running' | 'completed' | 'failed';

export const GENERATION_PUBLISH_MODES = ['asap', 'scheduled'] as const;
export type GenerationPublishMode = (typeof GENERATION_PUBLISH_MODES)[number];

export interface GenerationPersistence {
  params: Record<string, unknown>;
  mode: GenerationPublishMode;
  slotAt: string;
}

export interface RecordGenerationStartInput {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  personaId?: string | null;
  personaName?: string | null;
  videoSubject?: string | null;
  persistence?: GenerationPersistence | null;
}

export async function recordGenerationStart(input: RecordGenerationStartInput): Promise<void> {
  try {
    const persistence = input.persistence;
    const { error } = await input.supabase.from('video_generations').insert({
      user_id: input.userId,
      generation_id: input.generationId,
      persona_id: input.personaId ?? null,
      persona_name: input.personaName ?? null,
      video_subject: input.videoSubject ?? null,
      params: persistence?.params ?? null,
      publish_mode: persistence?.mode ?? 'asap',
      scheduled_at: persistence && persistence.mode === 'scheduled' ? persistence.slotAt : null,
      status: 'pending',
    });
    if (error) {
      logger.error('[generation] failed to record generation start', error, { generationId: input.generationId });
    }
  } catch (error) {
    logger.error('[generation] failed to record generation start', error, { generationId: input.generationId });
  }
}

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
