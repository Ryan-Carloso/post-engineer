import { LIPSYNC_WINDOW_SECONDS, MAX_LIPSYNC_PHOTOS, MIN_LIPSYNC_PHOTOS } from '@/lib/contracts/videos';
import { isHttpUrl } from '@/lib/generation/custom-audio';
import { isVideoRef } from '@/lib/generation/segment-media';
import type { VideoType } from '@/lib/tokens';
import { invalid, type Checked, type ValidationIssue } from './validation-issues';

export interface LipsyncPhotoRef {
  mediaId?: string;
  url?: string;
}

const FIELD = 'options.lipsyncPhotos';

export const LIPSYNC_PHOTOS_REQUIRED_MESSAGE =
  `options.lipsyncPhotos is required for videoType 'full_lipsync': send ${MIN_LIPSYNC_PHOTOS}-${MAX_LIPSYNC_PHOTOS} different face photos of the persona, ` +
  `one per ${LIPSYNC_WINDOW_SECONDS}s window of narration (a 40s video has 4 windows). Each item is { mediaId } or { url }.`;

export const LIPSYNC_PHOTOS_ONLY_FULL_MESSAGE =
  "options.lipsyncPhotos applies only to videoType 'full_lipsync': the other modes have no full talking-head video.";

function normalizedRef(photo: LipsyncPhotoRef, index: number): LipsyncPhotoRef | ValidationIssue {
  const field = `${FIELD}.${index}`;
  const mediaId = (photo.mediaId ?? '').trim();
  const url = (photo.url ?? '').trim();
  if ((mediaId.length > 0) === (url.length > 0)) {
    return invalid(`${field} must carry exactly one of mediaId or url.`, field);
  }
  if (url.length > 0 && !isHttpUrl(url)) {
    return invalid(`${field}.url must be a valid http(s) URL.`, field);
  }
  if (isVideoRef(photo)) {
    return invalid(`${field} is a video clip: full lip sync needs a still photo of the persona's face.`, field);
  }
  return mediaId.length > 0 ? { mediaId } : { url };
}

function refKey(ref: LipsyncPhotoRef): string {
  return ref.mediaId !== undefined ? `mediaId:${ref.mediaId}` : `url:${ref.url}`;
}

export function validateLipsyncPhotos(
  photos: LipsyncPhotoRef[] | undefined,
  mode: VideoType | undefined,
): Checked<LipsyncPhotoRef[] | undefined> {
  if (mode === undefined) return { ok: true, value: undefined };
  if (mode !== 'full_lipsync') {
    if (photos === undefined) return { ok: true, value: undefined };
    return { ok: false, issues: [invalid(LIPSYNC_PHOTOS_ONLY_FULL_MESSAGE, FIELD)] };
  }
  if (photos === undefined) {
    return { ok: false, issues: [invalid(LIPSYNC_PHOTOS_REQUIRED_MESSAGE, FIELD)] };
  }
  if (photos.length < MIN_LIPSYNC_PHOTOS || photos.length > MAX_LIPSYNC_PHOTOS) {
    return {
      ok: false,
      issues: [
        invalid(
          `options.lipsyncPhotos has ${photos.length} photos: send ${MIN_LIPSYNC_PHOTOS}-${MAX_LIPSYNC_PHOTOS} different face photos of the persona, one per ${LIPSYNC_WINDOW_SECONDS}s window.`,
          FIELD,
        ),
      ],
    };
  }
  const issues: ValidationIssue[] = [];
  const refs: LipsyncPhotoRef[] = [];
  const seen = new Map<string, number>();
  photos.forEach((photo, index) => {
    const ref = normalizedRef(photo, index);
    if ('code' in ref) {
      issues.push(ref);
      return;
    }
    refs.push(ref);
    const key = refKey(ref);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push(
        invalid(
          `${FIELD}.${index} repeats photo ${earlier}: every window needs a different photo of the persona.`,
          `${FIELD}.${index}`,
        ),
      );
      return;
    }
    seen.set(key, index);
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: refs };
}
