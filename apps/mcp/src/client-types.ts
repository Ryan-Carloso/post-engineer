// Input/output shapes for the Post Engineer API client.
//
// Extracted from client.ts so the client module stays under the file-size
// ratchet. client.ts re-exports every name here, so existing import sites
// (`./client.js`) keep working.
import { VIDEO_LAYOUTS } from './limits.js';

export interface PostEngineerClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Clock override used by schedule validation (tests); defaults to the real clock. */
  now?: () => Date;
}

/** One image for a persona's image library, read from a local file. */
export interface PersonaLibraryImageInput {
  /** Local file path (JPG/JPEG, PNG, or WebP, max 10MB). */
  path: string;
  /** Short tag for deterministic per-video matching (e.g. casual, formal). */
  tag?: string;
  /** Description of the photo for keyword matching. */
  description?: string;
}

/**
 * How the persona hook is composed with the video material. Mirrors the server's
 * accepted values so an unknown layout is a compile error here rather than
 * a 400 from the API.
 */
export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

export interface CreatePersonaInput {
  name: string;
  /** REQUIRED — every persona has a face. */
  avatarUrl: string;
  voiceId: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  videoLayout?: VideoLayout;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceQuality?: 'ok' | 'very_good';
  /** Up to 10 local images of the same person for the image library. */
  images?: PersonaLibraryImageInput[];
  /** Index into images[] marking the primary library image. */
  imagePrimaryIndex?: number;
}

export interface GeneratePersonaVideosInput {
  /**
   * Optional. Omit it for a faceless post defined entirely by `options` —
   * the persona is then not just a face: it is where the voice, the script
   * prompt, the aspect ratio and the niche come from. A post without one
   * MUST set options.faceless and one of options.voiceId / options.audioUrl.
   */
  personaId?: string;
  /** One topic per video, 1-10. */
  topics: string[];
  providers: ('youtube' | 'instagram' | 'linkedin' | 'bluesky')[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
  /**
   * Publish mode. 'scheduled' (default) distributes publish slots across
   * startAt + times; 'asap' publishes each video the moment generation
   * finishes, with no scheduled time. In 'asap' mode startAt/times must not
   * be set.
   */
  mode?: 'scheduled' | 'asap';
  /** ISO datetime when the first publish slot may start; naive values are wall-clock in timezone. Required unless mode is 'asap'. */
  startAt?: string;
  /** Daily publish times (HH:MM, 24h). Required unless mode is 'asap'. */
  times?: string[];
  /** IANA timezone for a naive startAt and the times (display-only in 'asap' mode). Defaults to UTC. */
  timezone?: string;
  options?: {
    faceless?: boolean;
    /** Stock footage only ('broll') or drawn illustrations only ('svg'), with or without a face. */
    facelessMaterial?: 'broll' | 'svg';
    audioUrl?: string;
    imageId?: string;
    scriptPrompt?: string;
    scriptPrompts?: string[];
    voiceId?: string;
    webhookUrl?: string;
    videoAspect?: '9:16' | '16:9';
    videoLayout?: VideoLayout;
    paragraphNumber?: number;
    language?: string;
    niche?: string;
    /** Segments script (MCP first, Phase 1): first hook, body segments, last CTA. Validated by the web route before any token debit. */
    segments?: Array<{
      kind: 'hook' | 'body' | 'cta';
      text: string;
      media?: { mediaId?: string; url?: string };
      terms?: string[];
    }>;
  };
  /** Omitted: a UUID is generated per call, so a retry cannot double-generate. */
  idempotencyKey?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  avatarUrl?: string;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  videoLayout?: VideoLayout;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
}

/** Input for publishing a user-provided video directly, without generation. */
export interface PublishVideoDirectInput {
  provider: 'youtube' | 'instagram' | 'linkedin' | 'bluesky';
  /** Local path to the video file (.mp4 or .mov, max 2GB). */
  videoPath: string;
  /** Target accounts (channel IDs / IG user IDs / DIDs / LinkedIn member IDs or org URNs). */
  accountIds: string[];
  /** YouTube only: required. */
  title?: string;
  /** YouTube only: required. */
  description?: string;
  /** YouTube only: required, at least one tag. */
  tags?: string[];
  /** YouTube only: required. */
  privacyStatus?: 'public' | 'private' | 'unlisted';
  /** Instagram/Bluesky/LinkedIn: required. */
  caption?: string;
}

/** One per-account outcome from a direct-publish upload. */
export interface DirectPublishAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  postId?: string;
  error?: string;
}

/** Narrowed POST /api/upload-content response. */
export interface DirectPublishResult {
  success: boolean;
  provider: string;
  results: DirectPublishAccountResult[];
  successCount: number;
  logId: string;
}
