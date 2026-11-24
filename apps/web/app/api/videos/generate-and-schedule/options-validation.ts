import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isPublicHttpsWebhookUrl } from '@/lib/ssrf/webhook-url';
import { SUBTITLE_POSITIONS, VIDEO_TRANSITION_MODES, type SubtitlePosition, type VideoTransitionMode } from '@/lib/contracts/videos';
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
import { validateLipsyncPhotos, type LipsyncPhotoRef } from './lipsync-photos';

const MAX_LANGUAGE_CHARS = 32;

export interface OptionsInput {
  videoType?: string;
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  lipsyncPhotos?: LipsyncPhotoRef[];
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
  subtitlePosition?: string;
  subtitleCustomPosition?: number;
}

export interface ValidatedOptions {
  videoType: VideoType;
  musicMood?: string;
  audioUrl?: string;
  imageId?: string;
  lipsyncPhotos?: LipsyncPhotoRef[];
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
  subtitlePosition?: SubtitlePosition;
  subtitleCustomPosition?: number;
}

const TRANSITION_MODES: readonly string[] = VIDEO_TRANSITION_MODES;

function isVideoTransitionMode(value: string): value is VideoTransitionMode {
  return TRANSITION_MODES.includes(value);
}

const SUBTITLE_POSITIONS_LIST: readonly string[] = SUBTITLE_POSITIONS;

function isSubtitlePosition(value: string): value is SubtitlePosition {
  return SUBTITLE_POSITIONS_LIST.includes(value);
}

export const SUBTITLE_CUSTOM_POSITION_ONLY_CUSTOM_MESSAGE =
  "options.subtitleCustomPosition applies only with options.subtitlePosition 'custom'.";

export const HOOK_PANEL_ONLY_HOOK_LIPSYNC_MESSAGE =
  "options.hookPanel applies only to videoType 'hook_lipsync': the other modes have no lip-sync hook.";

export function validateOptions(options: OptionsInput): Checked<ValidatedOptions> {
  const {
    videoType,
    musicMood,
    audioUrl,
    imageId,
    lipsyncPhotos,
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
    subtitlePosition,
    subtitleCustomPosition,
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
  if (videoType === 'voiceover' && imageId !== undefined) {
    issues.push(
      invalid('options.imageId cannot be used with voiceover videos: there is no face to render.', 'options.imageId'),
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
  let subtitle: SubtitlePosition | undefined;
  if (subtitlePosition !== undefined) {
    if (!isSubtitlePosition(subtitlePosition)) {
      issues.push(
        invalid(`options.subtitlePosition must be one of ${SUBTITLE_POSITIONS.join(', ')}.`, 'options.subtitlePosition'),
      );
    } else {
      subtitle = subtitlePosition;
    }
  }
  if (
    subtitleCustomPosition !== undefined &&
    (!Number.isInteger(subtitleCustomPosition) || subtitleCustomPosition < 0 || subtitleCustomPosition > 100)
  ) {
    issues.push(invalid('options.subtitleCustomPosition must be an integer between 0 and 100.', 'options.subtitleCustomPosition'));
  }
  if (subtitleCustomPosition !== undefined && subtitle !== 'custom') {
    issues.push(invalid(SUBTITLE_CUSTOM_POSITION_ONLY_CUSTOM_MESSAGE, 'options.subtitleCustomPosition'));
  }
  const photos = validateLipsyncPhotos(lipsyncPhotos, mode);
  if (!photos.ok) issues.push(...photos.issues);
  if (issues.length > 0 || !photos.ok) return { ok: false, issues };
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
      lipsyncPhotos: photos.value,
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
      subtitlePosition: subtitle,
      subtitleCustomPosition,
    },
  };
}
