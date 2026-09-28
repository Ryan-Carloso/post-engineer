export interface AccountData {
  provider: 'youtube';
  recordId: string;
  channelId: string;
  channelName: string;
  email?: string;
  thumbnail?: string;
  customUrl?: string;
  connectedAt: number;
  lastUsed: number;
  statistics?: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
    hiddenSubscriberCount?: boolean;
  };
}

//---------------
// Instagram Types — public format (NO OAuth tokens).
//---------------

export interface InstagramAccountData {
  provider: 'instagram';
  recordId: string;
  igUserId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  connectedAt: number;
  lastUsed: number;
}

//---------------
// UI / Client Types
//---------------

export type PrivacyStatus = 'public' | 'private' | 'unlisted';

export interface AccountResponse {
  authenticated: boolean;
  accounts: AccountData[];
  message?: string;
}

export interface InstagramAccountResponse {
  authenticated: boolean;
  accounts: InstagramAccountData[];
  message?: string;
}

export type MediaUploadErrorCode =
  | 'FILE_REQUIRED'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FORMAT_NOT_ALLOWED'
  | 'CONTENT_UNRECOGNIZED'
  | 'TYPE_MISMATCH';

export interface MediaUploadIssue {
  field: string;
  code: MediaUploadErrorCode;
}

//---------------
// Unified upload — POST /api/upload-content (multiple accounts per network)
//---------------

interface UploadContentAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  uploadDuration?: string;
  postId?: string;
  mediaId?: string;
  permalink?: string;
  error?: string;
}

export interface UploadContentResult {
  success: boolean;
  provider?: SocialProvider;
  results?: UploadContentAccountResult[];
  logId?: string;
  error?: string;
  suggestions?: string[];
}

//---------------
// Persona — persona creation flow types
//---------------

export interface CreatePersonaResult {
  success: boolean;
  personaId?: string;
  error?: string;
  // Present when images[] were uploaded at creation: the inserted image
  // rows, plus any partial-success warning codes (stable codes like
  // 'primary_swap_failed', mapped through i18n by the UI).
  imageIds?: string[];
  warnings?: string[];
}

export interface GeneratePersonaAvatarResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

export interface VoiceOption {
  id: string;
}

//---------------
// SocialProvider — single source in lib/providers/registry.ts.
// Re-exported here for convenience; do NOT duplicate the list.
//---------------

import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';

export { SOCIAL_PROVIDERS, type SocialProvider };
