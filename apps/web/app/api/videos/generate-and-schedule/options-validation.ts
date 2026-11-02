//---------------
// Options validation — extracted from route.ts so the route file, already
// over the 500-line cap, does not grow. Pure move: every check runs BEFORE
// any token is charged, exactly as before.
//---------------

import type { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isHttpUrl } from '@/lib/generation/custom-audio';
import { MAX_TITLE_CHARS, validationFailed } from './prepare-persona';

// Mirrors the engine's PersonaParams caps (apps/engine/app/models/schema.py):
// rejecting at the same boundary here is what turns an opaque engine
// validation error into a 400 that names the field.
const MAX_LANGUAGE_CHARS = 32;

/** Raw options as parsed from the request body (subset validateOptions reads). */
export interface OptionsInput {
  faceless?: boolean;
  facelessMaterial?: 'broll' | 'svg';
  fullLipsync?: boolean;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9';
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}

/** Validated options. videoLayout stays unset here (as before): preparePost
 *  falls back to the persona's layout when it is absent. */
export interface ValidatedOptions {
  faceless: boolean;
  /** Resolved here: 'broll' when omitted. Applies to every post, with or
   *  without a face (stock only, or illustrations only). */
  facelessMaterial: 'broll' | 'svg';
  /** Opt-in full lip-sync (whole video talking head, no b-roll). */
  fullLipsync?: boolean;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9';
  /** 'standard' = the avatar fills the frame; 'react' = the frame splits,
   *  avatar on top and the video material below. Absent means standard. */
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}

export function validateOptions(options: OptionsInput): ValidatedOptions | NextResponse {
  const {
    faceless = false,
    facelessMaterial,
    fullLipsync,
    audioUrl,
    imageId,
    webhookUrl,
    voiceId,
    videoAspect,
    paragraphNumber,
    language,
    niche,
  } = options;
  if (typeof faceless !== 'boolean') {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.faceless must be a boolean.', 'options.faceless');
  }
  if (fullLipsync === true && faceless) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.fullLipsync cannot be used with faceless videos: there is no face to render.',
      'options.fullLipsync',
    );
  }
  if (audioUrl !== undefined && !isHttpUrl(audioUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.audioUrl must be a valid http(s) URL.', 'options.audioUrl');
  }
  if (imageId !== undefined && imageId.trim().length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.imageId must be a non-empty string.', 'options.imageId');
  }
  if (faceless && imageId !== undefined) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.imageId cannot be used with faceless videos: there is no face to render.',
      'options.imageId',
    );
  }
  if (webhookUrl !== undefined && !isHttpUrl(webhookUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.webhookUrl must be a valid http(s) URL.', 'options.webhookUrl');
  }
  if (voiceId !== undefined && voiceId.trim().length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.voiceId must be a non-empty string.', 'options.voiceId');
  }
  // Caps mirroring the persona's own validation, so a persona-less post is
  // rejected with the persona editor's message, not an opaque engine error.
  if (language !== undefined && language.length > MAX_LANGUAGE_CHARS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.language must be at most ${MAX_LANGUAGE_CHARS} characters.`,
      'options.language',
    );
  }
  // English-only launch: a video in any other language is rejected here
  // (and again on the effective language in preparePersona).
  if (language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      ONLY_ENGLISH_VIDEOS_MESSAGE,
      'options.language',
    );
  }
  if (niche !== undefined && niche.length > MAX_TITLE_CHARS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.niche must be at most ${MAX_TITLE_CHARS} characters.`,
      'options.niche',
    );
  }
  return {
    faceless,
    facelessMaterial: facelessMaterial ?? 'broll',
    fullLipsync,
    audioUrl,
    imageId: imageId?.trim(),
    webhookUrl,
    voiceId: voiceId?.trim(),
    videoAspect,
    paragraphNumber,
    language,
    niche,
  };
}
