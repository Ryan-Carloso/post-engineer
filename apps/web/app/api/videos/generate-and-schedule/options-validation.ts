//---------------
// Options validation. Every check runs BEFORE any token is charged, and
// every failing check is reported (not just the first one).
//---------------

import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isHttpUrl } from '@/lib/generation/custom-audio';
import { isMusicMood, MUSIC_MOOD_NONE, unknownMusicMoodMessage } from '@/lib/generation/music-moods';
import {
  VIDEO_TYPE_REQUIRED_MESSAGE,
  isVideoType,
  unknownVideoTypeMessage,
  type VideoType,
} from '@/lib/tokens';
import { MAX_TITLE_CHARS } from './prepare-persona';
import { invalid, type Checked, type ValidationIssue } from './validation-issues';

// Mirrors the engine's PersonaParams caps (apps/engine/app/models/schema.py):
// rejecting at the same boundary here is what turns an opaque engine
// validation error into a 400 that names the field.
const MAX_LANGUAGE_CHARS = 32;

/** Raw options as parsed from the request body (subset validateOptions reads).
 *  videoType is an untrusted string here: the shape parse already rejects
 *  an invalid value with the same message, but an absent options object
 *  never reaches the shape, so this validator is the one that rejects a
 *  missing mode — with the same values + costs message. */
export interface OptionsInput {
  videoType?: string;
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9' | '1:1';
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}

/** Validated options. videoLayout stays unset here (as before): preparePost
 *  falls back to the persona's layout when it is absent. */
export interface ValidatedOptions {
  /** The one video mode: full_lipsync, hook_lipsync or faceless. */
  videoType: VideoType;
  /** BGM mood (issue #489): a catalogued mood, or "none" for no music; omitted = engine default. */
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9' | '1:1';
  /** 'standard' = the avatar fills the frame; 'react' = the frame splits,
   *  avatar on top and the video material below. Absent means standard. */
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}

export function validateOptions(options: OptionsInput): Checked<ValidatedOptions> {
  const {
    videoType,
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
  // The mode is narrowed once, here: a missing or invalid mode always
  // pushes an issue above, so reaching the return below with no mode is
  // impossible — the guard after the issues check is fail-closed, not an
  // assertion.
  const mode = videoType !== undefined && isVideoType(videoType) ? videoType : undefined;
  if (videoType === undefined) {
    issues.push(invalid(VIDEO_TYPE_REQUIRED_MESSAGE, 'options.videoType'));
  } else if (mode === undefined) {
    issues.push(invalid(unknownVideoTypeMessage(videoType), 'options.videoType'));
  }
  if (audioUrl !== undefined && !isHttpUrl(audioUrl)) {
    issues.push(invalid('options.audioUrl must be a valid http(s) URL.', 'options.audioUrl'));
  }
  // The mood must name a catalogued mood (or "none" for no music): the
  // engine rejects unknown moods at dispatch, after the charge, so this
  // pre-charge check is what makes the 400 — with the valid list — reach
  // the caller instead of a failed, refunded slot.
  if (musicMood !== undefined && musicMood !== MUSIC_MOOD_NONE && !isMusicMood(musicMood)) {
    issues.push(invalid(unknownMusicMoodMessage(musicMood), 'options.musicMood'));
  }
  if (imageId !== undefined && imageId.trim().length === 0) {
    issues.push(invalid('options.imageId must be a non-empty string.', 'options.imageId'));
  }
  if (videoType === 'faceless' && imageId !== undefined) {
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
  if (mode === undefined) {
    // Unreachable: a missing or invalid mode always pushed an issue above.
    return { ok: false, issues: [invalid(VIDEO_TYPE_REQUIRED_MESSAGE, 'options.videoType')] };
  }
  return {
    ok: true,
    value: {
      videoType: mode,
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
