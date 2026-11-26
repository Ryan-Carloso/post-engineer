export type AccountSyncStatus = 'ok' | 'error';

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
  status?: AccountSyncStatus;
  statistics?: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
    hiddenSubscriberCount?: boolean;
  };
}

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
  status?: AccountSyncStatus;
}

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

export interface CreatePersonaResult {
  success: boolean;
  personaId?: string;
  error?: string;
}

import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';

export { SOCIAL_PROVIDERS, type SocialProvider };
