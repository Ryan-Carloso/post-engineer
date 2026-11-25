import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { engineAuthHeaders } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { coded, validationFailed } from './prepare-persona';
import { memoize, withBudget, type NarrationOutcome, type PreflightShared } from './preflight-shared';

export const FULL_LIPSYNC_MAX_SECONDS = 60;

export const FULL_LIPSYNC_PREFLIGHT_TIMEOUT_MS = 180_000;

export interface FullLipsyncPreflightInput {
  userId: string;
  script: string;
  language: string | null;
  voiceId?: string;
  voiceAudioUrl?: string;
  shared?: PreflightShared;
}

export function checkFullLipsyncNarration(input: FullLipsyncPreflightInput): Promise<NarrationOutcome> {
  const { shared } = input;
  if (shared === undefined) return requestNarration(input);
  return memoize(shared.narrations, narrationKey(input), () => requestNarration(input));
}

function narrationKey(input: FullLipsyncPreflightInput): string {
  return JSON.stringify([input.script, input.language, input.voiceId ?? null, input.voiceAudioUrl ?? null]);
}

async function requestNarration(input: FullLipsyncPreflightInput): Promise<NarrationOutcome> {
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl || !process.env.MONEYPRINT_API_SECRET) {
    logger.error('[full-lipsync-preflight] engine URL or secret is not defined');
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FULL_LIPSYNC_PREFLIGHT_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/audio/preflight-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...engineAuthHeaders(input.userId),
      },
      body: JSON.stringify({
        video_script: input.script,
        video_language: input.language ?? '',
        voice_name: input.voiceId ?? '',
        voice_audio_url: input.voiceAudioUrl ?? null,
      }),
      signal: withBudget(controller.signal, input.shared),
    });
  } catch (error) {
    logger.error('[full-lipsync-preflight] engine unreachable', error);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
  if (upstream.status === 400) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.videoType narration exceeds the 60s full lip-sync limit, or the narration audio was rejected: shorten the script or use audio under 60s.',
      'options.videoType',
    );
  }
  if (!upstream.ok) {
    logger.error('[full-lipsync-preflight] engine preflight failed', undefined, {
      status: upstream.status,
    });
    return coded(502, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  const parsed: unknown = await upstream.json().catch(() => null);
  const duration = (parsed as { body?: { audio_duration_seconds?: unknown } } | null)?.body
    ?.audio_duration_seconds;
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    logger.error('[full-lipsync-preflight] engine preflight returned no numeric duration');
    return coded(502, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  if (duration > FULL_LIPSYNC_MAX_SECONDS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.videoType narration is ${duration}s long — the full lip-sync limit is ${FULL_LIPSYNC_MAX_SECONDS}s. Shorten the script.`,
      'options.videoType',
    );
  }
  return duration;
}
