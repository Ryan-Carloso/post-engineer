import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES } from '@/lib/error-codes';
import { resolveVideoImage } from '@/lib/persona-images';
import type { VideoType } from '@/lib/tokens';
import { signedUrl } from './persona-prep';
import { coded, validationFailed } from './prepare-persona';

/**
 * Resolve the persona fallback photo once, pre-charge (issue #589):
 * the signed URL of the library image dispatch will send as the
 * persona fallback photo, or null when no library image was picked.
 * The pre-charge face check validates this URL, not the stored avatar,
 * because the engine face-gates the library file dispatch signs.
 *
 * The pinned image is resolved here as before (fail fast when the id
 * does not resolve); unpinned face modes resolve the library pick with
 * the exact inputs dispatch uses (recentIds starts empty; one video
 * per request). Dispatch resolves again with identical inputs and
 * agrees, barring a concurrent library edit mid-request — the engine
 * preflight is the backstop for that. Returns a response on any
 * failure instead of throwing: a library that cannot be read, or an
 * image that cannot be signed, is a 500 before any charge.
 */
export async function resolvePreChargeLibraryPhoto(
  supabase: SupabaseClient,
  input: {
    personaId: string | null;
    userId: string;
    title: string;
    niche: string | null;
    script: string;
    videoType: VideoType;
    requestedImageId: string | null;
  },
): Promise<{ libraryPhotoUrl: string | null } | NextResponse> {
  let libraryImagePath: string | null = null;
  if (input.requestedImageId && input.personaId !== null) {
    const imageCheck = await resolveVideoImage(supabase, input.personaId, input.userId, [], {
      title: input.title,
      niche: input.niche,
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
      niche: input.niche,
      script: input.script,
      imageId: input.requestedImageId,
    });
    if (!selection.ok) {
      return coded(500, ERROR_CODES.INTERNAL_ERROR, selection.error);
    }
    libraryImagePath = selection.image?.image_path ?? null;
  }
  if (libraryImagePath === null) return { libraryPhotoUrl: null };
  // signedUrl resolves undefined on failure, never null.
  const libraryPhotoUrl = (await signedUrl(supabase, libraryImagePath)) ?? null;
  if (libraryPhotoUrl === null) {
    return coded(500, ERROR_CODES.INTERNAL_ERROR, 'The selected persona image could not be loaded. Please try again.');
  }
  return { libraryPhotoUrl };
}
