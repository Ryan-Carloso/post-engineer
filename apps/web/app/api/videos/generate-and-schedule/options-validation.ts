import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isPublicHttpsWebhookUrl } from '@/lib/ssrf/webhook-url';
import { VIDEO_TRANSITION_MODES, type VideoTransitionMode } from '@/lib/contracts/videos';
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

const MAX_LANGUAGE_CHARS = 32;

export interface OptionsInput {
  videoType?: string;
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9' | '1:1';
  videoLayout?: 'standard' | 'react';
  hookPanel?: boolean;
  paragraphNumber?: number;
  language?: string;
  niche?: string;
  videoClipDuration?: number;
  videoTransitionMode?: string;
  videoVariationSeed?: number;
}

export interface ValidatedOptions {
  videoType: VideoType;
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9' | '1:1';
  videoLayout?: 'standard' | 'react';
  hookPanel?: boolean;
  paragraphNumber?: number;
  language?: string;
  niche?: string;
  videoClipDuration?: number;
  videoTransitionMode?: VideoTransitionMode;
  videoVariationSeed?: number;
}

const TRANSITION_MODES: readonly string[] = VIDEO_TRANSITION_MODES;

function isVideoTransitionMode(value: string): value is VideoTransitionMode {
  return TRANSITION_MODES.includes(value);
}

export const HOOK_PANEL_ONLY_HOOK_LIPSYNC_MESSAGE =
  "options.hookPanel applies only to videoType 'hook_lipsync': the other modes have no lip-sync hook.";

export function validateOptions(options: OptionsInput): Checked<ValidatedOptions> {
  const {
    videoType,
    musicMood,
    audioUrl,
    imageId,
    webhookUrl,
    voiceId,
    videoAspect,
    videoLayout,
    hookPanel,
    paragraphNumber,
    language,
    niche,
    videoClipDuration,
    videoTransitionMode,
    videoVariationSeed,
  } = options;
  const issues: ValidationIssue[] = [];
  const mode = videoType !== undefined && isVideoType(videoType) ? videoType : undefined;
  if (videoType === undefined) {
    issues.push(invalid(VIDEO_TYPE_REQUIRED_MESSAGE, 'options.videoType'));
  } else if (mode === undefined) {
    issues.push(invalid(unknownVideoTypeMessage(videoType), 'options.videoType'));
  }
  if (audioUrl !== undefined && !isHttpUrl(audioUrl)) {
    issues.push(invalid('options.audioUrl must be a valid http(s) URL.', 'options.audioUrl'));
  }
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
  if (webhookUrl !== undefined && !isPublicHttpsWebhookUrl(webhookUrl)) {
    issues.push(invalid('options.webhookUrl must be a public https URL.', 'options.webhookUrl'));
  }
  if (voiceId !== undefined && voiceId.trim().length === 0) {
    issues.push(invalid('options.voiceId must be a non-empty string.', 'options.voiceId'));
  }
  if (language !== undefined && language.length > MAX_LANGUAGE_CHARS) {
    issues.push(invalid(`options.language must be at most ${MAX_LANGUAGE_CHARS} characters.`, 'options.language'));
  }
  if (language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
    issues.push(invalid(ONLY_ENGLISH_VIDEOS_MESSAGE, 'options.language'));
  }
  if (niche !== undefined && niche.length > MAX_TITLE_CHARS) {
    issues.push(invalid(`options.niche must be at most ${MAX_TITLE_CHARS} characters.`, 'options.niche'));
  }
  if (hookPanel !== undefined && mode !== undefined && mode !== 'hook_lipsync') {
    issues.push(invalid(HOOK_PANEL_ONLY_HOOK_LIPSYNC_MESSAGE, 'options.hookPanel'));
  }
  if (
    videoClipDuration !== undefined &&
    (!Number.isInteger(videoClipDuration) || videoClipDuration < 1 || videoClipDuration > 60)
  ) {
    issues.push(invalid('options.videoClipDuration must be an integer between 1 and 60.', 'options.videoClipDuration'));
  }
  let transitionMode: VideoTransitionMode | undefined;
  if (videoTransitionMode !== undefined) {
    if (!isVideoTransitionMode(videoTransitionMode)) {
      issues.push(
        invalid(`options.videoTransitionMode must be one of ${VIDEO_TRANSITION_MODES.join(', ')}.`, 'options.videoTransitionMode'),
      );
    } else {
      transitionMode = videoTransitionMode;
    }
  }
  if (videoVariationSeed !== undefined && !Number.isInteger(videoVariationSeed)) {
    issues.push(invalid('options.videoVariationSeed must be an integer.', 'options.videoVariationSeed'));
  }
  if (issues.length > 0) return { ok: false, issues };
  if (mode === undefined) {
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
      videoLayout,
      hookPanel,
      paragraphNumber,
      language,
      niche,
      videoClipDuration,
      videoTransitionMode: transitionMode,
      videoVariationSeed,
    },
  };
}
