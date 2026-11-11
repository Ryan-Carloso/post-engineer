//---------------
// Full lip-sync preflight — TRUE pre-charge rejection for >60s narration.
//
// The engine only learns the real TTS duration inside the video task,
// and the route charges (spend_tokens) before dispatching that task, so
// a >60s full-mode request used to be charged first and refunded after
// the engine rejected it. This module closes the gap: before any charge,
// it asks the engine preflight endpoint (POST /api/v1/audio/
// preflight-duration) to synthesize the exact narration the video task
// will synthesize and return its measured duration. Only a measured
// duration at or under the cap proceeds to charging.
//
// This is a measurement, never an estimate: no word-count guard is used
// here (156 words measured 51.36s in the dev complete video, ~182 wpm,
// so any word cap tight enough to guarantee <=60s would reject proven
// valid videos, and any loose one would let slow narrations through).
// The engine 60s guard stays as the backstop for provider nondeterminism
// between the preflight synthesis and the video task's own synthesis.
//
// Cost honesty: the narration is synthesized twice (once here, once in
// the video task, so the video's subtitle timeline comes from its own
// TTS run). Local Chatterbox voices pay CPU time; ElevenLabs/OpenRouter
// voices are billed twice for the same script. That is the price of a
// true pre-charge guarantee under charge-before-dispatch, stated in the
// PR body rather than hidden.
//
// Failure is fail-closed: an unreachable engine, a timeout, a non-JSON
// answer, or a non-numeric duration returns a 502 with NO charge, never
// a proceed. A preflight 400 (the voice-audio download rejecting the
// file, including its own 60s limit) returns a 400, also with no charge.
//---------------

import type { NextResponse } from 'next/server';

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { engineAuthHeaders } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { coded, validationFailed } from './prepare-persona';

/** Mirrors the engine cap (apps/engine/app/services/full_lipsync.py
 *  MAX_FULL_LIPSYNC_SECONDS); both literals are pinned by tests. There
 *  is no shared web/engine constant to import, so a change here must
 *  change the engine value in the same change. */
export const FULL_LIPSYNC_MAX_SECONDS = 60;

// TTS for a ~60s script is seconds for API voices but can take a minute
// on local CPU voices; past this the request fails closed (502, no
// charge) rather than charging on an unknown duration.
export const FULL_LIPSYNC_PREFLIGHT_TIMEOUT_MS = 180_000;

export interface FullLipsyncPreflightInput {
  userId: string;
  /** Joined segments script — the exact text the video task will speak. */
  script: string;
  /** Effective language (per-post override, else the persona's). */
  language: string | null;
  /** Resolved voice id (undefined when the narration is voice audio). */
  voiceId?: string;
  /** Custom/voice-audio URL (undefined for TTS narration). */
  voiceAudioUrl?: string;
}

/**
 * Measure the full-mode narration before charging. Returns the measured
 * duration in seconds when it fits the cap, otherwise a NextResponse:
 * 400 naming options.videoType when the narration exceeds 60s (or the
 * voice-audio download rejects it), 502 when the duration is unknown.
 * Callers must return the response without charging on any failure.
 */
export async function checkFullLipsyncNarration(
  input: FullLipsyncPreflightInput,
): Promise<number | NextResponse> {
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
      signal: controller.signal,
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
