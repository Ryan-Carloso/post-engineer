import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import {
  EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS,
  EXPERIMENT_MAX_TOTAL_VIDEOS,
} from '@/lib/contracts/experiments';
import { ERROR_CODES } from '@/lib/error-codes';
import { checkSemantics } from '../videos/generate-and-schedule/request-validation';
import type { CheckedRequest } from '../videos/generate-and-schedule/request-validation';
import type { ValidationIssue } from '../videos/generate-and-schedule/validation-issues';
import type { LipsyncPhotoRef } from '../videos/generate-and-schedule/lipsync-photos';

export const EXPERIMENT_ROUTE = 'POST /api/experiments';

export const SEGMENTS_FIELD = 'options.segments';

export function shapeCountIssues(body: CreateExperimentBody): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const perVariant = body.variants[0].videos.length;
  body.variants.forEach((variant, index) => {
    if (variant.videos.length !== perVariant) {
      issues.push({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `Every variant needs the same number of videos: variants.0 has ${perVariant}, variants.${index} has ${variant.videos.length}.`,
        field: `variants.${index}.videos`,
      });
    }
  });
  const total = body.variants.reduce((sum, variant) => sum + variant.videos.length, 0);
  if (total > EXPERIMENT_MAX_TOTAL_VIDEOS) {
    issues.push({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `An experiment holds at most ${EXPERIMENT_MAX_TOTAL_VIDEOS} videos in total; this one has ${total}.`,
      field: 'variants',
    });
  }
  if (body.videoType === 'full_lipsync' && total > EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS) {
    issues.push({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `A full lip-sync experiment holds at most ${EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS} videos in total, so every narration can be checked before anything is charged; this one has ${total}: send fewer videos, or use hook_lipsync or voiceover for up to ${EXPERIMENT_MAX_TOTAL_VIDEOS}.`,
      field: 'variants',
    });
  }
  const seen = new Set<string>();
  body.variants.forEach((variant, index) => {
    if (seen.has(variant.versionId)) {
      issues.push({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `variants.${index}.versionId repeats an earlier variant: compare different prompt versions.`,
        field: `variants.${index}.versionId`,
      });
    }
    seen.add(variant.versionId);
  });
  return issues;
}

function videoField(prefix: string, field: string | undefined): string | undefined {
  if (field === undefined) return prefix;
  if (field === 'title' || field === 'description') return `${prefix}.${field}`;
  if (field.startsWith(SEGMENTS_FIELD)) return `${prefix}.segments${field.slice(SEGMENTS_FIELD.length)}`;
  return field;
}

export interface CheckedVideo {
  variantIndex: number;
  videoIndex: number;
  checked: CheckedRequest;
}

export type SemanticOutcome =
  | { ok: true; videos: CheckedVideo[]; options: CheckedRequest['options']; providers: CheckedRequest['providers'] }
  | { ok: false; issues: ValidationIssue[] };

export function checkExperimentSemantics(body: CreateExperimentBody, personaId: string | null): SemanticOutcome {
  const issues: ValidationIssue[] = [];
  const seenIssues = new Set<string>();
  const videos: CheckedVideo[] = [];
  body.variants.forEach((variant, variantIndex) => {
    variant.videos.forEach((video, videoIndex) => {
      const checked = checkSemantics({
        title: video.title,
        description: video.description,
        segments: video.segments,
        providers: [body.account.provider],
        options: { ...(body.options ?? {}), videoType: body.videoType },
        personaId,
      });
      if (checked.ok) {
        videos.push({ variantIndex, videoIndex, checked: checked.value });
        return;
      }
      const prefix = `variants.${variantIndex}.videos.${videoIndex}`;
      for (const issue of checked.issues) {
        const field = videoField(prefix, issue.field);
        const key = `${issue.code}|${field ?? ''}|${issue.message}`;
        if (seenIssues.has(key)) continue;
        seenIssues.add(key);
        issues.push({ ...issue, field });
      }
    });
  });
  if (issues.length > 0 || videos.length === 0) return { ok: false, issues };
  const [first] = videos;
  return { ok: true, videos, options: first.checked.options, providers: first.checked.providers };
}

function mediaIdsOf(segments: unknown, lipsyncPhotos: LipsyncPhotoRef[] | undefined): string[] {
  const ids: string[] = [];
  if (Array.isArray(segments)) {
    for (const segment of segments) {
      const media = (segment as { media?: unknown }).media;
      if (!Array.isArray(media)) continue;
      for (const item of media) {
        const mediaId = (item as { mediaId?: unknown }).mediaId;
        if (typeof mediaId === 'string' && mediaId.length > 0) ids.push(mediaId);
      }
    }
  }
  for (const photo of lipsyncPhotos ?? []) {
    if (typeof photo.mediaId === 'string' && photo.mediaId.length > 0) ids.push(photo.mediaId);
  }
  return ids;
}

export const MEDIA_ID_MAX_SPAN_MS = 24 * 60 * 60 * 1000;

export function mediaIdIssue(
  body: CreateExperimentBody,
  lipsyncPhotos: LipsyncPhotoRef[] | undefined,
  spanMs: number,
): ValidationIssue | null {
  if (spanMs <= MEDIA_ID_MAX_SPAN_MS) return null;
  for (const [variantIndex, variant] of body.variants.entries()) {
    for (const [videoIndex, video] of variant.videos.entries()) {
      if (mediaIdsOf(video.segments, undefined).length > 0) {
        return {
          code: ERROR_CODES.VALIDATION_FAILED,
          message:
            'This experiment spreads its videos over more than one day, and an uploaded mediaId does not last that long: use public image or video URLs in the segments.',
          field: `variants.${variantIndex}.videos.${videoIndex}.segments`,
        };
      }
    }
  }
  if (mediaIdsOf(undefined, lipsyncPhotos).length > 0) {
    return {
      code: ERROR_CODES.VALIDATION_FAILED,
      message:
        'This experiment spreads its videos over more than one day, and an uploaded mediaId does not last that long: use public URLs in options.lipsyncPhotos.',
      field: 'options.lipsyncPhotos',
    };
  }
  return null;
}
