import type { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import type { VideoAspectOption } from './media-check';
import type { ValidatedOptions } from './options-validation';
import type { PersonaPrep } from './persona-prep';
import { validationFailed } from './prepare-persona';

export function resolveVideoAspect(
  options: Pick<ValidatedOptions, 'videoAspect'>,
  prep: Pick<PersonaPrep, 'videoAspect'>,
): VideoAspectOption | NextResponse {
  const effectiveAspect = options.videoAspect ?? prep.videoAspect ?? '9:16';
  if (effectiveAspect !== '9:16' && effectiveAspect !== '16:9' && effectiveAspect !== '1:1') {
    const message = `Persona video aspect is '${effectiveAspect}', expected 9:16, 16:9 or 1:1: update the persona.`;
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, message, 'personaId');
  }
  return effectiveAspect === '16:9' || effectiveAspect === '1:1' ? effectiveAspect : '9:16';
}
