import { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import { firstSegmentMedia } from '@/lib/hook-photo';
import type { SegmentMediaRef } from '@/lib/hook-photo';
import type { VideoType } from '@/lib/tokens';
import { validationFailed } from './prepare-persona';
import { checkFullLipsyncNarration } from './full-lipsync-preflight';
import { fetchMediaCheck, type VideoAspectOption } from './media-check';
import { checkLipsyncPhotoFaces } from './lipsync-photo-faces';
import type { PreflightShared } from './preflight-shared';
import { resolveVideoAspect } from './video-aspect';
import type { PersonaPrep } from './persona-prep';
import type { ValidatedOptions } from './options-validation';

export interface SegmentMediaAspectInput {
  userId: string;
  segments: unknown;
  videoAspect: VideoAspectOption;
  hasFace: boolean;
  videoType: VideoType;
  shared?: PreflightShared;
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
      input.shared,
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
  shared?: PreflightShared;
}

const MECHANICAL_REJECTION_REASONS: Record<string, string> = {
  not_image: 'is not a readable image',
  too_small: 'is too small',
  too_large: 'is too large',
};

function mechanicalRejectionReason(code: unknown): string | undefined {
  return typeof code === 'string' ? MECHANICAL_REJECTION_REASONS[code] : undefined;
}

export async function checkFirstPhotoFace(
  input: FirstPhotoFaceInput,
): Promise<null | NextResponse> {
  if (input.videoType === 'voiceover' || input.videoType === 'full_lipsync') return null;
  const first = firstSegmentMedia(input.segments);
  if (first === null) return null;
  const record = await fetchMediaCheck(
    first,
    input.userId,
    input.videoAspect,
    'first-photo-face',
    input.shared,
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

export interface PreChargePreflightInput {
  userId: string;
  script: string;
  prep: PersonaPrep;
  options: ValidatedOptions;
  segments: unknown;
  shared?: PreflightShared;
  skipLipsyncPhotoFaces?: boolean;
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
      shared: input.shared,
    });
    if (narration instanceof NextResponse) return narration;
  }
  if (input.segments === undefined) return null;
  const videoAspect = resolveVideoAspect(input.options, input.prep);
  if (videoAspect instanceof NextResponse) return videoAspect;
  const aspect = await checkSegmentMediaAspect({
    userId: input.userId,
    segments: input.segments,
    videoAspect,
    hasFace: input.options.videoType !== 'voiceover' && input.prep.photoPath !== null,
    videoType: input.options.videoType,
    shared: input.shared,
  });
  if (aspect instanceof NextResponse) return aspect;
  if (input.options.videoType === 'full_lipsync') {
    if (input.skipLipsyncPhotoFaces === true) return null;
    return checkLipsyncPhotoFaces(input.userId, input.options.lipsyncPhotos ?? [], videoAspect, input.shared);
  }
  return checkFirstPhotoFace({
    userId: input.userId,
    segments: input.segments,
    videoAspect,
    videoType: input.options.videoType,
    shared: input.shared,
  });
}
