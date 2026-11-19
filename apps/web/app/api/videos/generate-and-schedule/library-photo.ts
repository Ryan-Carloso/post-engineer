import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES } from '@/lib/error-codes';
import { resolveVideoImage } from '@/lib/persona-images';
import type { VideoType } from '@/lib/tokens';
import { signedUrl, type PersonaPrep } from './persona-prep';
import { coded, validationFailed } from './prepare-persona';

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
