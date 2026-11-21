import { VIDEO_LAYOUTS } from './limits.js';
import type { FaceQuality, VideoAspect } from './contracts/personas.js';
import type { PersonaCtaType } from './contracts/personas.js';
import type { VideoType } from './video-type.js';
import type { SocialProvider } from './contracts/providers.js';

export type { VideoType } from './video-type.js';

export interface PostEngineerClientOptions {
  apiKey?: string;
  baseUrl?: string;
  now?: () => Date;
  suppressVersionHeader?: boolean;
}

export interface PersonaLibraryImageInput {
  path: string;
  tag?: string;
  description?: string;
}

export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

export interface PersonaCtaInput {
  type: PersonaCtaType;
  url?: string;
  instruction?: string;
}

export interface CreatePersonaInput {
  name: string;
  avatarUrl?: string;
  avatarPath?: string;
  voiceId: string;
  language?: string;
  videoAspect?: VideoAspect;
  videoLayout?: VideoLayout;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceQuality?: FaceQuality;
  cta?: PersonaCtaInput;
  accounts: Record<string, string[]>;
  images?: PersonaLibraryImageInput[];
  imagePrimaryIndex?: number;
}

export interface GeneratePersonaVideoInput {
  personaId?: string;
  title: string;
  description: string;
  promptVersionId?: string;
  cta?: PersonaCtaInput | null;
  providers: SocialProvider[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
  threadsAccountIds?: string[];
  facebookAccountIds?: string[];
  pinterestAccountIds?: string[];
  pinterestBoardId?: string;
  fanvueAccountIds?: string[];
  threespeakAccountIds?: string[];
  rumbleAccountIds?: string[];
  telegramAccountIds?: string[];
  mode?: 'scheduled' | 'asap';
  startAt?: string;
  times?: string[];
  timezone?: string;
  options?: {
    videoType: VideoType;
    musicMood?: string;
    audioUrl?: string;
    imageId?: string;
    voiceId?: string;
    webhookUrl?: string;
    videoAspect?: '9:16' | '16:9' | '1:1';
    videoLayout?: VideoLayout;
    paragraphNumber?: number;
    language?: string;
    niche?: string;
    segments?: Array<{
      kind: 'hook' | 'content';
      text: string;
      cta?: boolean;
      media?: Array<{ mediaId?: string; url?: string; overlay?: { title: string; subtitle?: string; badge?: string } }>;
    }>;
  };
  idempotencyKey?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  avatarUrl?: string;
  avatarPath?: string;
  voiceId?: string;
  language?: string;
  videoAspect?: VideoAspect;
  videoLayout?: VideoLayout;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceQuality?: FaceQuality;
  cta?: PersonaCtaInput;
}

export interface PublishVideoDirectInput {
  provider: SocialProvider;
  videoPath: string;
  accountIds: string[];
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  caption?: string;
  boardId?: string;
  idempotencyKey?: string;
}

export interface PublishUploadedVideoInput {
  provider: SocialProvider;
  uploadId: string;
  accountIds: string[];
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  caption?: string;
  boardId?: string;
}

export interface MintedVideoUpload {
  uploadId: string;
  signedUrl: string;
  token: string;
  expiresAt: string;
  maxBytes: number;
}

export interface CompletedVideoUpload {
  uploadId: string;
  status: 'ready';
  contentType: string;
  sizeBytes: number;
}

export interface PublishExistingInput {
  media:
    | { kind: 'task'; taskId: string }
    | { kind: 'upload'; uploadId: string }
    | { kind: 'image'; imageData: string; contentType: 'image/jpeg' | 'image/png' };
  accounts: Partial<Record<SocialProvider, string[]>>;
  title: string;
  description: string;
  caption?: string;
  personaId?: string;
  mode: 'asap' | 'scheduled';
  publishAt?: string;
  timezone: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  boardId?: string;
  idempotencyKey: string;
}

export interface PublishExistingSlot {
  id: string;
  slot_at: string;
  title: string;
  status: string;
}

export interface PublishExistingReconnectWarning {
  code: 'account_needs_reconnect';
  accounts: Array<{ provider: string; accountId: string }>;
}

export type PublishExistingResult =
  | {
      mode: 'scheduled';
      success: true;
      replayed: boolean;
      scheduleId: string;
      slots: PublishExistingSlot[];
      warnings?: PublishExistingReconnectWarning[];
    }
  | {
      mode: 'asap';
      success: boolean;
      replayed: boolean;
      mediaKind: 'task' | 'upload' | 'image';
      publishes: Array<{ provider: string; success: boolean; results: DirectPublishAccountResult[] }>;
      logId: string;
    };

export interface DirectPublishAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface DirectPublishResult {
  success: boolean;
  provider: string;
  results: DirectPublishAccountResult[];
  successCount: number;
  logId: string;
}
