import { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import { isHttpUrl } from '@/lib/generation/custom-audio';
import { firstSegmentMedia } from '@/lib/hook-photo';
import type { SegmentMediaRef } from '@/lib/hook-photo';
import { engineAuthHeaders } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import type { VideoType } from '@/lib/tokens';
import { coded, validationFailed } from './prepare-persona';
import { checkFullLipsyncNarration } from './full-lipsync-preflight';
import type { PersonaPrep } from './persona-prep';
import type { ValidatedOptions } from './options-validation';

export const MEDIA_CHECK_TIMEOUT_MS = 30_000;

export type VideoAspectOption = '9:16' | '16:9' | '1:1';

export interface SegmentMediaAspectInput {
  userId: string;
  segments: unknown;
  videoAspect: VideoAspectOption;
  hasFace: boolean;
  videoType: VideoType;
}

interface MediaCheckRecord {
  code?: unknown;
  width?: unknown;
  height?: unknown;
  has_face?: unknown;
}

async function fetchMediaCheck(
  ref: SegmentMediaRef,
  userId: string,
  videoAspect: VideoAspectOption,
  logTag: string,
): Promise<MediaCheckRecord | NextResponse> {
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl || !process.env.MONEYPRINT_API_SECRET) {
    logger.error(`[${logTag}] engine URL or secret is not defined`);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_CHECK_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/media/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...engineAuthHeaders(userId),
      },
      body: JSON.stringify(
        ref.mediaId !== undefined
          ? { media_id: ref.mediaId, video_aspect: videoAspect }
          : { url: ref.url, video_aspect: videoAspect },
      ),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    logger.error(`[${logTag}] engine unreachable`, error);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  clearTimeout(timeout);
  if (!upstream.ok) {
    logger.error(`[${logTag}] engine check failed`, undefined, {
      status: upstream.status,
    });
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const parsed: unknown = await upstream.json().catch(() => null);
  const body = (parsed as { body?: unknown } | null)?.body;
  const record = (
    typeof body === 'object' && body !== null ? body : {}
  ) as MediaCheckRecord;
  if (typeof record.code !== 'string') {
    logger.error(`[${logTag}] engine check returned no code`);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  return record;
}

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
  videoType: VideoType,
): SegmentMediaRef[] {
  if (videoType === 'full_lipsync') return [];
  if (!Array.isArray(segments)) return [];
  const refs: SegmentMediaRef[] = [];
  segments.forEach((segment, segmentIndex) => {
    if (typeof segment !== 'object' || segment === null) return;
    const record = segment as { kind?: unknown; media?: unknown };
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

export async function checkSegmentMediaAspect(
  input: SegmentMediaAspectInput,
): Promise<null | NextResponse> {
  const refs = fullFrameMedia(input.segments, input.hasFace, input.videoType);
  if (refs.length === 0) return null;
  const [targetW, targetH] = aspectResolution(input.videoAspect);
  for (const ref of refs) {
    const record = await fetchMediaCheck(
      ref,
      input.userId,
      input.videoAspect,
      'segment-media-aspect',
    );
    if (record instanceof NextResponse) return record;
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
  }
  return null;
}

export interface FirstPhotoFaceInput {
  userId: string;
  segments: unknown;
  videoAspect: VideoAspectOption;
  videoType: VideoType;
  avatarUrl: string | null;
  photoPathUrl: string | null;
  libraryPhotoUrl: string | null;
}

const MECHANICAL_REJECTION_REASONS: Record<string, string> = {
  not_image: 'is not a readable image',
  too_small: 'is too small',
  too_large: 'is too large',
};

function mechanicalRejectionReason(code: unknown): string | undefined {
  return typeof code === 'string' ? MECHANICAL_REJECTION_REASONS[code] : undefined;
}

async function checkFallbackPhotoUrl(
  userId: string,
  videoAspect: VideoAspectOption,
  url: string,
  subject: string,
  field: string,
): Promise<null | NextResponse> {
  const record = await fetchMediaCheck(
    { segmentIndex: 0, imageIndex: 0, url },
    userId,
    videoAspect,
    'first-photo-face',
  );
  if (record instanceof NextResponse) return record;
  if (record.code === 'not_image') {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `${subject} is not a readable image: lip sync needs a usable photo of the persona's face.`,
      field,
    );
  }
  if (record.has_face === false) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `${subject} has no detectable face: lip sync needs a photo of the persona's face.`,
      field,
    );
  }
  return null;
}

export async function checkFirstPhotoFace(
  input: FirstPhotoFaceInput,
): Promise<null | NextResponse> {
  if (input.videoType === 'faceless') return null;
  const first = firstSegmentMedia(input.segments);
  if (first !== null) {
    const record = await fetchMediaCheck(
      first,
      input.userId,
      input.videoAspect,
      'first-photo-face',
    );
    if (record instanceof NextResponse) return record;
    const rejection = mechanicalRejectionReason(record.code);
    if (rejection !== undefined) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Segment ${first.segmentIndex} image ${first.imageIndex} is the first photo of this video, but it ${rejection}: send a usable photo showing the persona's face.`,
        'options.segments',
      );
    }
    if (
      record.code === 'blocked_403' ||
      record.code === 'timeout' ||
      record.code === 'media_expired'
    ) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Segment ${first.segmentIndex} image ${first.imageIndex} is the first photo of this video, but it could not be loaded (${record.code}): send a usable photo showing the persona's face.`,
        'options.segments',
      );
    }
    if (record.has_face === false) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Segment ${first.segmentIndex} image ${first.imageIndex} is the first photo of this video, but no face was detected in it: send a photo showing the persona's face.`,
        'options.segments',
      );
    }
    return null;
  }
  if (input.libraryPhotoUrl !== null) {
    return checkFallbackPhotoUrl(
      input.userId,
      input.videoAspect,
      input.libraryPhotoUrl,
      'The photo selected for this video',
      'personaId',
    );
  }
  if (input.avatarUrl === null && input.photoPathUrl !== null) {
    return checkFallbackPhotoUrl(
      input.userId,
      input.videoAspect,
      input.photoPathUrl,
      'The persona photo',
      'personaId',
    );
  }
  if (input.avatarUrl === null || !isHttpUrl(input.avatarUrl)) return null;
  return checkFallbackPhotoUrl(
    input.userId,
    input.videoAspect,
    input.avatarUrl,
    'The persona photo',
    'personaId',
  );
}

export interface PreChargePreflightInput {
  userId: string;
  script: string;
  prep: PersonaPrep;
  options: ValidatedOptions;
  segments: unknown;
  libraryPhotoUrl: string | null;
  photoPathUrl: string | null;
}

export async function checkPreChargePreflights(
  input: PreChargePreflightInput,
): Promise<null | NextResponse> {
  if (input.options.videoType === 'full_lipsync') {
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
  const videoAspect: VideoAspectOption =
    effectiveAspect === '16:9' || effectiveAspect === '1:1' ? effectiveAspect : '9:16';
  const aspect = await checkSegmentMediaAspect({
    userId: input.userId,
    segments: input.segments,
    videoAspect,
    hasFace: input.options.videoType !== 'faceless' && input.prep.photoPath !== null,
    videoType: input.options.videoType,
  });
  if (aspect instanceof NextResponse) return aspect;
  return checkFirstPhotoFace({
    userId: input.userId,
    segments: input.segments,
    videoAspect,
    videoType: input.options.videoType,
    avatarUrl: input.prep.avatarUrl,
    libraryPhotoUrl: input.libraryPhotoUrl,
    photoPathUrl: input.photoPathUrl,
  });
}
