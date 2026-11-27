import type { FirstCommentWarningCode } from '@/lib/contracts/first-comment';
import type { SocialProvider } from '@/lib/types';

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
  errorCode?: string;
  warnings?: FirstCommentWarningCode[];
}

interface ContentUploadSuccess {
  success: true;
  provider: SocialProvider;
  results: ContentUploadAccountResult[];
  logId: string;
}

interface ContentUploadFailure {
  success: false;
  error: string;
  errorType: string;
  logId: string;
  suggestions?: string[];
}

export type ContentUploadResponse = ContentUploadSuccess | ContentUploadFailure;
