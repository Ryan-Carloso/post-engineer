import type { SocialProvider } from '@/lib/types';

//---------------
// Upload result shapes — the per-account outcome of one upload-content
// call. Extracted from lib/upload/handlers.ts (file-size ratchet); the
// handlers import these types back.
//---------------

export interface ContentUploadAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  uploadDuration?: string;
  postId?: string;
  mediaId?: string;
  permalink?: string;
  error?: string;
  // Stable per-account failure code from classifyUploadAccountError
  // (#504): 'transient' | 'token_expired' | 'disconnected' |
  // 'publish_rejected' | 'email_not_verified'. The retry loop and the
  // user notice read this, never the free-text error.
  errorCode?: string;
}

export interface ContentUploadSuccess {
  success: true;
  provider: SocialProvider;
  results: ContentUploadAccountResult[];
  logId: string;
}

export interface ContentUploadFailure {
  success: false;
  error: string;
  errorType: string;
  logId: string;
  suggestions?: string[];
}

export type ContentUploadResponse = ContentUploadSuccess | ContentUploadFailure;
