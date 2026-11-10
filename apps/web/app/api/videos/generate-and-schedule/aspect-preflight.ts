//---------------
// Segment-media aspect preflight — TRUE pre-charge rejection for a
// wrong-ratio photo that would fill the frame.
//
// The engine only learns an image's dimensions inside the video task,
// and the route charges (spend_tokens) before dispatching that task, so
// without this a wrong-ratio photo would be charged first and refunded
// after the task failed — or worse, ship as a blurred strip over the
// frame. This module closes the gap: before any charge, it asks the
// engine media/check endpoint about every photo that will fill the
// frame, and the first mismatch is a 400 naming the segment, the image,
// the ratio it sent, and the ratio the video needs.
//
// A photo shown as a panel over the face is contained by the panel, so
// only full-frame photos are gated: no face means every segment fills
// the frame; a hook-only face means every segment except the hook; a
// full lip-sync face fills the whole video, so nothing is gated.
//
// Failure is fail-closed: an unreachable engine, a timeout, a non-JSON
// answer, or a missing code returns a 502 with NO charge, never a
// proceed. Any other code (ok, or a skip the task already handles — an
// expired media id, a blocked download, a face) never blocks here.
//
// Both pre-charge checks live in this module — the narration-length
// check (full lip-sync) first, then the aspect check — so route.ts
// stays under the file-size ratchet: one call site instead of two
// preflight blocks.
//---------------

import { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import { engineAuthHeaders } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { coded, validationFailed } from './prepare-persona';
import { checkFullLipsyncNarration } from './full-lipsync-preflight';
import type { PersonaPrep } from './persona-prep';
import type { ValidatedOptions } from './options-validation';

// One media check is a local resolve or a single download; past this
// the request fails closed (502, no charge) rather than charging on an
// unknown ratio.
export const SEGMENT_MEDIA_ASPECT_TIMEOUT_MS = 30_000;

export type VideoAspectOption = '9:16' | '16:9' | '1:1';

export interface SegmentMediaAspectInput {
  userId: string;
  /** Raw segments from the request (already shape-validated upstream). */
  segments: unknown;
  videoAspect: VideoAspectOption;
  /** True when the persona's face shows in this video. */
  hasFace: boolean;
  /** True when the face fills the whole video (full lip-sync). */
  fullLipsync?: boolean;
}

interface SegmentMediaRef {
  segmentIndex: number;
  imageIndex: number;
  mediaId?: string;
  url?: string;
}

// Mirrors the engine (media_aspect.ratio_label and
// VideoAspect.to_resolution): the web cannot import engine code, so the
// gcd and the aspect -> resolution mapping live in both places. The
// tests below pin the mapping through the 400 error strings; change
// both sides together.
function ratioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function aspectResolution(aspect: VideoAspectOption): [number, number] {
  if (aspect === '16:9') return [1920, 1080];
  if (aspect === '1:1') return [1080, 1080];
  return [1080, 1920];
}

function fullFrameMedia(
  segments: unknown,
  hasFace: boolean,
  fullLipsync?: boolean,
): SegmentMediaRef[] {
  if (fullLipsync === true) return [];
  if (!Array.isArray(segments)) return [];
  const refs: SegmentMediaRef[] = [];
  segments.forEach((segment, segmentIndex) => {
    if (typeof segment !== 'object' || segment === null) return;
    const record = segment as { kind?: unknown; media?: unknown };
    // A hook-only face shows the hook segment's photos as panels over
    // the face; every other segment fills the frame.
    if (hasFace && record.kind === 'hook') return;
    if (!Array.isArray(record.media)) return;
    record.media.forEach((item, imageIndex) => {
      if (typeof item !== 'object' || item === null) return;
      const media = item as { mediaId?: unknown; url?: unknown };
      if (typeof media.mediaId === 'string' && media.mediaId.length > 0) {
        refs.push({ segmentIndex, imageIndex, mediaId: media.mediaId });
      } else if (typeof media.url === 'string' && media.url.length > 0) {
        refs.push({ segmentIndex, imageIndex, url: media.url });
      }
    });
  });
  return refs;
}

/**
 * Check every full-frame segment photo against the video aspect before
 * charging. Returns null when all of them fit (or there are none), and
 * a NextResponse otherwise: 400 naming the first mismatched photo,
 * 502 when the ratio is unknown. Callers must return the response
 * without charging on any failure.
 */
export async function checkSegmentMediaAspect(
  input: SegmentMediaAspectInput,
): Promise<null | NextResponse> {
  const refs = fullFrameMedia(input.segments, input.hasFace, input.fullLipsync);
  // No full-frame photo to check (text-only segments, panels under the
  // face, full lip-sync) needs no engine call — and must not fail a
  // request that never touches the engine.
  if (refs.length === 0) return null;
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl || !process.env.MONEYPRINT_API_SECRET) {
    logger.error('[segment-media-aspect] engine URL or secret is not defined');
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const [targetW, targetH] = aspectResolution(input.videoAspect);
  for (const ref of refs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEGMENT_MEDIA_ASPECT_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/media/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineAuthHeaders(input.userId),
        },
        body: JSON.stringify(
          ref.mediaId !== undefined
            ? { media_id: ref.mediaId, video_aspect: input.videoAspect }
            : { url: ref.url, video_aspect: input.videoAspect },
        ),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      logger.error('[segment-media-aspect] engine unreachable', error);
      return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
    }
    clearTimeout(timeout);
    if (!upstream.ok) {
      logger.error('[segment-media-aspect] engine check failed', undefined, {
        status: upstream.status,
      });
      return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
    }
    const parsed: unknown = await upstream.json().catch(() => null);
    const body = (parsed as { body?: unknown } | null)?.body;
    const record = (
      typeof body === 'object' && body !== null ? body : {}
    ) as { code?: unknown; width?: unknown; height?: unknown };
    if (typeof record.code !== 'string') {
      logger.error('[segment-media-aspect] engine check returned no code');
      return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
    }
    if (record.code === 'wrong_aspect') {
      const width = typeof record.width === 'number' ? record.width : null;
      const height = typeof record.height === 'number' ? record.height : null;
      const sent =
        width !== null && height !== null
          ? `${width}x${height} (${ratioLabel(width, height)})`
          : 'the wrong ratio';
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Segment ${ref.segmentIndex} image ${ref.imageIndex} is ${sent}, but this video is ${input.videoAspect} (${targetW}x${targetH}): send a ${input.videoAspect} image for it.`,
        'options.segments',
      );
    }
    // Any other code (ok, or a skip the task already handles: expired
    // media, a blocked download, a face) never blocks the request here.
  }
  return null;
}

export interface PreChargePreflightInput {
  userId: string;
  /** Joined segments script — the exact text the video task will speak. */
  script: string;
  prep: PersonaPrep;
  options: ValidatedOptions;
  /** Raw segments from the request (already shape-validated upstream). */
  segments: unknown;
}

/**
 * Both pre-charge rejections, in route order: the full lip-sync
 * narration check first (only when full lip-sync is on), then the
 * segment-media aspect check (only when segments are present). Returns
 * the first failure, or null when nothing blocks the charge. Callers
 * must return the response without charging on any failure.
 */
export async function checkPreChargePreflights(
  input: PreChargePreflightInput,
): Promise<null | NextResponse> {
  if (input.options.fullLipsync === true) {
    const narration = await checkFullLipsyncNarration({
      userId: input.userId,
      script: input.script,
      language: input.prep.language,
      voiceId: input.prep.voiceIdValue,
      voiceAudioUrl: input.prep.voiceAudioUrl,
    });
    if (narration instanceof NextResponse) return narration;
  }
  if (input.segments === undefined) return null;
  // The persona's stored aspect is a free-form string, so an unknown
  // value fails fast instead of silently checking against portrait.
  const effectiveAspect =
    input.options.videoAspect ?? input.prep.videoAspect ?? '9:16';
  const aspectIsKnown =
    effectiveAspect === '9:16' ||
    effectiveAspect === '16:9' ||
    effectiveAspect === '1:1';
  if (!aspectIsKnown) {
    const message = `Persona video aspect is '${effectiveAspect}', expected 9:16, 16:9 or 1:1: update the persona.`;
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, message, 'personaId');
  }
  return checkSegmentMediaAspect({
    userId: input.userId,
    segments: input.segments,
    videoAspect:
      effectiveAspect === '16:9' || effectiveAspect === '1:1'
        ? effectiveAspect
        : '9:16',
    hasFace: !input.options.faceless && input.prep.photoPath !== null,
    fullLipsync: input.options.fullLipsync,
  });
}
