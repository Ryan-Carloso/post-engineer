import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES } from '@/lib/error-codes';
import { resolveVideoImage } from '@/lib/persona-images';
import type { VideoType } from '@/lib/tokens';
import { signedUrl, type PersonaPrep } from './persona-prep';
import { coded, validationFailed } from './prepare-persona';

/**
 * Resolve the persona fallback photos once, pre-charge (issue #589):
 * the signed URL of the library image dispatch will send as the
 * persona fallback photo (null when no library image was picked), and
 * the signed URL of the stored persona photo (null unless it is the
 * fallback: no library pick and no avatar). The pre-charge face check
 * validates these URLs, not the stored avatar, because the engine
 * face-gates the files dispatch signs.
 *
 * The pinned image is resolved here as before (fail fast when the id
 * does not resolve); unpinned face modes resolve the library pick with
 * the exact inputs dispatch uses (recentIds starts empty; one video
 * per request). Dispatch resolves again with identical inputs and
 * agrees, barring a concurrent library edit mid-request — the engine
 * preflight is the backstop for that. Returns a response on any
 * failure instead of throwing: a library that cannot be read, or an
 * image that cannot be signed, is a 500 before any charge. The stored
 * photo is signed only when the fallback branch will use it, so a
 * signing failure never blocks a request the avatar or library photo
 * already covers.
 */
export async function resolvePreChargeFallbackPhotos(
  supabase: SupabaseClient,
  input: {
    personaId: string | null;
    userId: string;
    title: string;
    script: string;
    videoType: VideoType;
    requestedImageId: string | null;
    prep: PersonaPrep;
  },
): Promise<{ libraryPhotoUrl: string | null; photoPathUrl: string | null } | NextResponse> {
  let libraryImagePath: string | null = null;
  if (input.requestedImageId && input.personaId !== null) {
    const imageCheck = await resolveVideoImage(supabase, input.personaId, input.userId, [], {
      title: input.title,
      niche: input.prep.niche,
      // Image keyword matching uses the actual segments script now, not
      // the removed prompt: the prompt was only ever a proxy for it.
      script: input.script,
      imageId: input.requestedImageId,
    });
    if (!imageCheck.ok) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, imageCheck.error, 'options.imageId', imageCheck.status);
    }
    libraryImagePath = imageCheck.image?.image_path ?? null;
  } else if (input.videoType !== 'faceless' && input.personaId !== null) {
    const selection = await resolveVideoImage(supabase, input.personaId, input.userId, [], {
      title: input.title,
      niche: input.prep.niche,
      script: input.script,
      imageId: input.requestedImageId,
    });
    if (!selection.ok) {
      return coded(500, ERROR_CODES.INTERNAL_ERROR, selection.error);
    }
    libraryImagePath = selection.image?.image_path ?? null;
  }
  let libraryPhotoUrl: string | null = null;
  if (libraryImagePath !== null) {
    // signedUrl resolves undefined on failure, never null.
    libraryPhotoUrl = (await signedUrl(supabase, libraryImagePath)) ?? null;
    if (libraryPhotoUrl === null) {
      return coded(500, ERROR_CODES.INTERNAL_ERROR, 'The selected persona image could not be loaded. Please try again.');
    }
  }
  let photoPathUrl: string | null = null;
  if (libraryPhotoUrl === null && input.prep.avatarUrl === null && input.prep.photoPath !== null) {
    photoPathUrl = (await signedUrl(supabase, input.prep.photoPath)) ?? null;
    if (photoPathUrl === null) {
      return coded(500, ERROR_CODES.INTERNAL_ERROR, 'The persona photo could not be loaded. Please try again.');
    }
  }
  return { libraryPhotoUrl, photoPathUrl };
}
