import { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import { fetchMediaCheck, type VideoAspectOption } from './media-check';
import type { LipsyncPhotoRef } from './lipsync-photos';
import { validationFailed } from './prepare-persona';

const UNUSABLE_REASONS: Record<string, string> = {
  not_image: 'is not a readable image',
  too_small: 'is too small',
  too_large: 'is too large',
  blocked_403: 'could not be loaded (blocked_403)',
  timeout: 'could not be loaded (timeout)',
  media_expired: 'could not be loaded (media_expired)',
};

export async function checkLipsyncPhotoFaces(
  userId: string,
  photos: LipsyncPhotoRef[],
  videoAspect: VideoAspectOption,
): Promise<null | NextResponse> {
  for (const [index, photo] of photos.entries()) {
    const record = await fetchMediaCheck(
      { segmentIndex: 0, imageIndex: index, ...photo },
      userId,
      videoAspect,
      'lipsync-photo-face',
    );
    if (record instanceof NextResponse) return record;
    const field = `options.lipsyncPhotos.${index}`;
    const reason: string | undefined = UNUSABLE_REASONS[record.code];
    if (reason !== undefined) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `${field} ${reason}: send a usable photo of the persona's face.`,
        field,
      );
    }
    if (record.has_face === false) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `${field} has no detectable face: full lip sync needs a photo of the persona's face for every window.`,
        field,
      );
    }
  }
  return null;
}
