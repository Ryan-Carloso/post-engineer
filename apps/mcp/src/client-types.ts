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
  /** Every persona has a face: exactly one of avatarUrl or avatarPath. */
  avatarUrl?: string;
  /** Local face photo, uploaded as the multipart `photo` file. */
  avatarPath?: string;
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

export interface GeneratePersonaVideoInput {
  /**
   * Optional. Omit it for a faceless post defined entirely by `options` —
   * the persona is then not just a face: it is where the voice, the
   * aspect ratio and the niche come from. A post without one
   * MUST set options.faceless and one of options.voiceId / options.audioUrl.
   */
  personaId?: string;
  /** The slot label for the single video. */
  title: string;
  /** Paired A/B experiment link (issue #476); checked server-side before the charge. */
  experiment?: { experimentId: string; variantId: string; pair: number };
  providers: ('youtube' | 'instagram' | 'linkedin' | 'bluesky' | 'threads' | 'facebook' | 'pinterest' | 'rumble')[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
  threadsAccountIds?: string[];
  facebookAccountIds?: string[];
  pinterestAccountIds?: string[];
  /** Pinterest only: the board the pin goes to (the id from list_pinterest_boards). Required when pinterest is selected. */
  pinterestBoardId?: string;
  rumbleAccountIds?: string[];
  /**
   * Publish mode. 'scheduled' (default) slots the video at startAt + times;
   * 'asap' publishes it the moment generation finishes, with no scheduled
   * time. In 'asap' mode startAt/times must not be set.
   */
  mode?: 'scheduled' | 'asap';
  /** ISO datetime when the publish slot may start; naive values are wall-clock in timezone. Required unless mode is 'asap'. */
  startAt?: string;
  /** Daily publish times (HH:MM, 24h). Required unless mode is 'asap'. */
  times?: string[];
  /** IANA timezone for a naive startAt and the times (display-only in 'asap' mode). Defaults to UTC. */
  timezone?: string;
  options?: {
    faceless?: boolean;
    /** Stock footage only ('broll'), drawn illustrations only ('svg') or only the segment images ('images'), with or without a face. */
    facelessMaterial?: 'broll' | 'svg' | 'images';
    /** Render the whole video as the persona talking, with no b-roll: every narration window is lip-synced to the persona face. Requires a persona with a photo and lip-sync enabled; cannot be combined with faceless. */
    fullLipsync?: boolean;
    /** Background-music mood: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood. */
    musicMood?: string;
    audioUrl?: string;
    imageId?: string;
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
      media?: Array<{ mediaId?: string; url?: string; overlay?: { title: string; subtitle?: string; badge?: string } }>;
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
  avatarPath?: string;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  videoLayout?: VideoLayout;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceQuality?: 'ok' | 'very_good';
}

/** Input for publishing a user-provided video directly, without generation. */
export interface PublishVideoDirectInput {
  provider: 'youtube' | 'instagram' | 'linkedin' | 'bluesky' | 'threads' | 'facebook' | 'pinterest' | 'rumble';
  /** Local path to the video file (.mp4 or .mov, max 2GB). */
  videoPath: string;
  /** Target accounts (channel IDs / IG user IDs / DIDs / LinkedIn member IDs or org URNs / Threads user IDs / Facebook Page IDs / Pinterest user IDs / Rumble Channel IDs). */
  accountIds: string[];
  /** YouTube and Rumble: required. Pinterest: pin title (optional). */
  title?: string;
  /** YouTube and Rumble: required. Pinterest: pin description (optional; caption is used when omitted). */
  description?: string;
  /** YouTube only: required, at least one tag. */
  tags?: string[];
  /** YouTube only: required. */
  privacyStatus?: 'public' | 'private' | 'unlisted';
  /** Instagram/Bluesky/LinkedIn/Threads/Facebook: required. Pinterest: pin description when description is omitted. */
  caption?: string;
  /** Pinterest only: required. The board the pin goes to (the id from list_pinterest_boards). */
  boardId?: string;
}

/** One per-account outcome from a direct-publish upload. */
export interface DirectPublishAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  postId?: string;
  /** Ready-made post URL (Pinterest pin URL, Instagram/Threads/Facebook permalink). */
  permalink?: string;
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
