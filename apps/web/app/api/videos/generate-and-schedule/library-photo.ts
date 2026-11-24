import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES } from '@/lib/error-codes';
import { resolveVideoImage } from '@/lib/persona-images';
import type { PersonaPrep } from './persona-prep';
import { validationFailed } from './prepare-persona';

export async function validatePreChargeImageId(
  supabase: SupabaseClient,
  input: {
    personaId: string | null;
    userId: string;
    title: string;
    script: string;
    requestedImageId: string | null;
    prep: PersonaPrep;
  },
): Promise<null | NextResponse> {
  if (input.requestedImageId === null || input.personaId === null) return null;
  const imageCheck = await resolveVideoImage(supabase, input.personaId, input.userId, [], {
    title: input.title,
    niche: input.prep.niche,
    script: input.script,
    imageId: input.requestedImageId,
  });
  if (!imageCheck.ok) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      imageCheck.error,
      'options.imageId',
      imageCheck.status,
    );
  }
  return null;
}
