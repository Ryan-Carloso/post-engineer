//---------------
// Options validation. Every check runs BEFORE any token is charged, and
// every failing check is reported (not just the first one).
//---------------

import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isHttpUrl } from '@/lib/generation/custom-audio';
import { MAX_TITLE_CHARS } from './prepare-persona';
import { invalid, type Checked, type ValidationIssue } from './validation-issues';

// Mirrors the engine's PersonaParams caps (apps/engine/app/models/schema.py):
// rejecting at the same boundary here is what turns an opaque engine
// validation error into a 400 that names the field.
const MAX_LANGUAGE_CHARS = 32;

/** Raw options as parsed from the request body (subset validateOptions reads). */
export interface OptionsInput {
  faceless?: boolean;
  fullLipsync?: boolean;
  musicMood?: string;
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
  /** Opt-in full lip-sync (whole video talking head). */
  fullLipsync?: boolean;
  /** BGM mood (issue #489): a catalogued mood, or "none" for no music; omitted = engine default. */
  musicMood?: string;
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

export function validateOptions(options: OptionsInput): Checked<ValidatedOptions> {
  const {
    faceless = false,
    fullLipsync,
    musicMood,
    audioUrl,
    imageId,
    webhookUrl,
    voiceId,
    videoAspect,
    paragraphNumber,
    language,
    niche,
  } = options;
  const issues: ValidationIssue[] = [];
  if (typeof faceless !== 'boolean') {
    issues.push(invalid('options.faceless must be a boolean.', 'options.faceless'));
  }
  if (fullLipsync === true && faceless) {
    issues.push(
      invalid('options.fullLipsync cannot be used with faceless videos: there is no face to render.', 'options.fullLipsync'),
    );
  }
  if (audioUrl !== undefined && !isHttpUrl(audioUrl)) {
    issues.push(invalid('options.audioUrl must be a valid http(s) URL.', 'options.audioUrl'));
  }
  if (imageId !== undefined && imageId.trim().length === 0) {
    issues.push(invalid('options.imageId must be a non-empty string.', 'options.imageId'));
  }
  if (faceless && imageId !== undefined) {
    issues.push(
      invalid('options.imageId cannot be used with faceless videos: there is no face to render.', 'options.imageId'),
    );
  }
  if (webhookUrl !== undefined && !isHttpUrl(webhookUrl)) {
    issues.push(invalid('options.webhookUrl must be a valid http(s) URL.', 'options.webhookUrl'));
  }
  if (voiceId !== undefined && voiceId.trim().length === 0) {
    issues.push(invalid('options.voiceId must be a non-empty string.', 'options.voiceId'));
  }
  // Caps mirroring the persona's own validation, so a persona-less post is
  // rejected with the persona editor's message, not an opaque engine error.
  if (language !== undefined && language.length > MAX_LANGUAGE_CHARS) {
    issues.push(invalid(`options.language must be at most ${MAX_LANGUAGE_CHARS} characters.`, 'options.language'));
  }
  // English-only launch: a video in any other language is rejected here
  // (and again on the effective language in preparePersona).
  if (language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
    issues.push(invalid(ONLY_ENGLISH_VIDEOS_MESSAGE, 'options.language'));
  }
  if (niche !== undefined && niche.length > MAX_TITLE_CHARS) {
    issues.push(invalid(`options.niche must be at most ${MAX_TITLE_CHARS} characters.`, 'options.niche'));
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      faceless,
      fullLipsync,
      musicMood,
      audioUrl,
      imageId: imageId?.trim(),
      webhookUrl,
      voiceId: voiceId?.trim(),
      videoAspect,
      paragraphNumber,
      language,
      niche,
    },
  };
}
