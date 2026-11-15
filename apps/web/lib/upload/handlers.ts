import 'server-only';

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createGoogleOAuth2Client, uploadYouTubeVideo, createVideoMetadata } from '@/lib/youtube';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { logger } from '@/lib/logger';
import { ValidationError, UploadError, AuthError, InstagramApiError } from '@/lib/errors';
import { withUploadTimeout } from '@/lib/timeout';
import {
  getSocialAccountTokens,
  touchSocialAccount,
  updateSocialAccountTokens,
  type SocialTokenPayload,
} from '@/lib/social-accounts';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { parseMediaUpload } from '@/lib/media/upload-schema';
import { InstagramService } from '@/lib/instagram';
import { cleanupPublishMedia, presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';
import { httpStatusOf, reportAccountUnauthorized } from './account-unauthorized';
import { classifyUploadAccountError } from '@/lib/upload/account-error';
import type { OAuth2Client } from 'google-auth-library';

// Upload handlers — one account failing does not abort the others.

import type { ContentUploadAccountResult, ContentUploadResponse } from './content-upload-result';

//---------------
// getAuthenticatedClient — OAuth client with the account's valid tokens
// (tokens decrypted from Supabase, owner = authenticated userId); also post-metrics
//---------------
export async function getAuthenticatedClient(
  ownerUserId: string,
  accountId: string,
): Promise<OAuth2Client> {
  const supabase = createSupabaseServiceClient();

  let tokens: SocialTokenPayload;
  try {
    const result = await getSocialAccountTokens(supabase, ownerUserId, 'youtube', accountId);
    tokens = result.tokens;
  } catch {
    throw new AuthError(
      `Account ${accountId} not found for the API key owner. Start the OAuth flow first`,
      'account_not_found',
    );
  }

  try {
    const oauth2Client = await createGoogleOAuth2Client();
    oauth2Client.setCredentials(tokens);

    if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
      const refreshed = await oauth2Client.refreshAccessToken();
      const newCredentials = refreshed.credentials;
      oauth2Client.setCredentials(newCredentials);
      // Persist refreshed tokens so subsequent uploads do not need to
      // re-refresh and users do not get spurious reconnect prompts.
      await updateSocialAccountTokens(supabase, ownerUserId, 'youtube', accountId, {
        access_token: newCredentials.access_token ?? tokens.access_token,
        refresh_token: newCredentials.refresh_token ?? tokens.refresh_token,
        token_type: newCredentials.token_type ?? undefined,
        expiry_date: newCredentials.expiry_date ?? undefined,
      });
    }

    await touchSocialAccount(supabase, ownerUserId, 'youtube', accountId);

    return oauth2Client;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Failed to load account token. Start the OAuth flow again', 'invalid_token');
  }
}

//---------------
// parseAccountIds — reads repeated accountIds/igAccountIds FormData fields
//---------------
function parseAccountIds(formData: FormData, field: 'accountIds' | 'igAccountIds'): string[] {
  return getAccountIdsFromFormData(formData, field);
}

//---------------
// handleYoutubeUpload — validates the video ONCE and uploads to each account
//---------------
export async function handleYoutubeUpload(
  formData: FormData,
  ownerUserId: string,
  logId: string,
  startTime: number,
): Promise<ContentUploadResponse> {
  const video = formData.get('video');
  const title = formData.get('title');
  const description = formData.get('description');
  const tags = formData.get('tags');
  const privacyStatus = formData.get('privacyStatus');
  const accountIds = parseAccountIds(formData, 'accountIds');

  if (accountIds.length === 0) {
    throw new ValidationError('At least one account ID is required', 'accountIds');
  }
  if (!(video instanceof File)) {
    throw new ValidationError('No video file was sent', 'video');
  }
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ValidationError('Video title is required', 'title');
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new ValidationError('Video description is required', 'description');
  }
  if (typeof tags !== 'string' || tags.trim() === '') {
    throw new ValidationError('Video tags are required', 'tags');
  }
  if (video.size > 2 * 1024 * 1024 * 1024) {
    throw new ValidationError('File too large. Maximum is 2GB', 'video');
  }
  if (!video.type.startsWith('video/')) {
    throw new ValidationError('Invalid file. Must be a video', 'video');
  }

  const parsedTags = tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (parsedTags.length === 0) {
    throw new ValidationError('At least one tag is required', 'tags');
  }

  const validPrivacyStatus = ['public', 'private', 'unlisted'];
  if (typeof privacyStatus !== 'string' || !validPrivacyStatus.includes(privacyStatus)) {
    throw new ValidationError('Invalid privacy status. Use "public", "private" or "unlisted"', 'privacyStatus');
  }

  const metadata = {
    title: title.trim(),
    description: description.trim(),
    tags: parsedTags,
    privacyStatus: privacyStatus as 'public' | 'private' | 'unlisted',
  };

  const arrayBuffer = await video.arrayBuffer();
  const videoBuffer = Buffer.from(arrayBuffer);
  const videoMetadata = createVideoMetadata(metadata);

  const results: ContentUploadAccountResult[] = [];

  for (const accountId of accountIds) {
    const accountStart = Date.now();
    try {
      // Ownership: getSocialAccountTokens only resolves the user's own accounts.
      const oauth2Client = await getAuthenticatedClient(ownerUserId, accountId);

      const uploadResult = await withUploadTimeout(
        uploadYouTubeVideo(oauth2Client, videoBuffer, videoMetadata),
      );

      const durationStr = `${((Date.now() - accountStart) / 1000).toFixed(2)}s`;

      logger.logUploadSuccess(logId, {
        videoId: uploadResult.id,
        videoUrl: uploadResult.url,
        duration: Date.now() - accountStart,
      });

      results.push({
        accountId,
        success: true,
        videoId: uploadResult.id,
        videoUrl: uploadResult.url,
        uploadDuration: durationStr,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upload error';
      logger.warn('upload-content/youtube: one account failed (continuing with the rest)', {
        logId,
        metadata: { accountId, error: message },
      });
      reportAccountUnauthorized('youtube', accountId, ownerUserId, error);
      results.push({ accountId, success: false, ...classifyUploadAccountError(error) });
    }
  }

  logger.info('Content upload (youtube) finished', {
    logId,
    metadata: {
      provider: 'youtube',
      totalAccounts: accountIds.length,
      successCount: results.filter((r) => r.success).length,
      duration: Date.now() - startTime,
    },
  });

  return { success: true, provider: 'youtube', results, logId };
}

function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };
  return map[mimeType] || 'bin';
}

export async function handleInstagramUpload(
  formData: FormData,
  ownerUserId: string,
  logId: string,
  startTime: number,
): Promise<ContentUploadResponse> {
  const accountIds = parseAccountIds(formData, 'igAccountIds');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('file');

  if (accountIds.length === 0) {
    throw new ValidationError('At least one Instagram account ID is required', 'igAccountIds');
  }
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') {
    throw new ValidationError('Caption is required', 'caption');
  }

  const storagePathRaw = formData.get('videoStoragePath');
  let publicUrl: string;
  let detectedType: string;
  let storagePath: string;
  let fileSize: number;
  let usedArchive = false;
  if (storagePathRaw !== null) {
    // Engine-generated final: already verified in R2, presign it directly.
    if (typeof storagePathRaw !== 'string' || storagePathRaw.trim() === '') {
      throw new ValidationError('videoStoragePath must be a string', 'videoStoragePath');
    }
    if (rawFile instanceof File) {
      throw new ValidationError('Send either a file or videoStoragePath, not both', 'videoStoragePath');
    }
    const objectKey = storagePathRaw.trim();
    if (!objectKey.startsWith(`${ownerUserId}/`)) {
      throw new ValidationError('videoStoragePath must belong to this user', 'videoStoragePath');
    }
    publicUrl = await presignPublishMedia(objectKey);
    detectedType = 'video/mp4';
    storagePath = objectKey;
    fileSize = 0;
    usedArchive = true;
  } else {
    let file: File | null = null;
    let buffer: Buffer = Buffer.alloc(0);
    if (rawFile instanceof File) {
      file = rawFile;
      buffer = Buffer.from(await file.arrayBuffer());
    }
    const parsed = parseMediaUpload(file, buffer);
    if (!parsed.success) {
      logger.warn('Media upload rejected during validation', {
        logId,
        endpoint: '/api/upload-content',
        metadata: { issues: parsed.issues },
      });
      throw new ValidationError(parsed.issues[0]?.code ?? 'FILE_REQUIRED', 'file');
    }
    const validated = parsed;
    detectedType = validated.detectedType;
    // Instagram fetches the media from a URL: store it on R2 (no egress fees).
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const extension = getExtension(detectedType);
    storagePath = `instagram/${timestamp}_${random}.${extension}`;
    publicUrl = await uploadPublishMedia(validated.buffer, storagePath, detectedType);
    fileSize = validated.buffer.length;
  }
  const isVideo = detectedType === 'video/mp4' || detectedType === 'video/quicktime';

  logger.info('upload-content/instagram: media stored, starting publishes', {
    logId,
    metadata: {
      accountCount: accountIds.length,
      detectedType,
      isVideo,
      fileSize,
      storagePath,
    },
  });

  const supabase = createSupabaseServiceClient();
  const results: ContentUploadAccountResult[] = [];

  for (const igUserId of accountIds) {
    try {
      // Ownership: getSocialAccountTokens only resolves the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'instagram', igUserId);

      if (typeof tokens.access_token !== 'string' || tokens.access_token === '') {
        throw new InstagramApiError('Instagram token not found', 401);
      }
      if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
        throw new InstagramApiError('Instagram token expired. Please reconnect the account.', 401);
      }

      const instagram = new InstagramService();
      const published = await instagram.publishMedia(
        igUserId,
        tokens.access_token,
        captionRaw.trim(),
        publicUrl,
        isVideo,
      );

      await touchSocialAccount(supabase, ownerUserId, 'instagram', igUserId);

      results.push({
        accountId: igUserId,
        success: true,
        postId: published.postId,
        mediaId: published.mediaId,
        permalink: published.permalink,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown publishing error';
      logger.warn('upload-content/instagram: one account failed (continuing with the rest)', {
        logId,
        metadata: { igUserId, error: message, status: httpStatusOf(error) },
      });
      reportAccountUnauthorized('instagram', igUserId, ownerUserId, error);
      results.push({ accountId: igUserId, success: false, ...classifyUploadAccountError(error) });
    }
  }

  // Archive presign created no temp copy, so there is nothing to clean.
  if (!usedArchive) {
    void cleanupPublishMedia('instagram');
  }

  logger.info('Content upload (instagram) finished', {
    logId,
    metadata: {
      provider: 'instagram',
      totalAccounts: accountIds.length,
      successCount: results.filter((r) => r.success).length,
      duration: Date.now() - startTime,
    },
  });

  return { success: true, provider: 'instagram', results, logId };
}

//---------------
// buildUploadErrorResponse — maps errors to a stable HTTP response
//---------------
export function buildUploadErrorResponse(
  error: unknown,
  logId: string,
  startTime: number,
): NextResponse {
  const duration = Date.now() - startTime;
  const errorMessage = error instanceof Error ? error.message : 'Unknown upload error';

  logger.logUploadError(logId, new Error(errorMessage), {
    duration,
    endpoint: '/api/upload-content',
    method: 'POST',
    metadata: {
      errorType: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    },
  });

  const suggestions: string[] = [];
  if (error instanceof ValidationError) {
    suggestions.push('Check the submitted data');
    if ('field' in error && typeof error.field === 'string') {
      suggestions.push(`Field "${error.field}" is invalid`);
    }
  } else if (error instanceof InstagramApiError) {
    suggestions.push('Check the media format and URL accessibility');
    if (error.statusCode === 401) {
      suggestions.push('Reconnect the Instagram account');
    }
  } else if (error instanceof UploadError) {
    suggestions.push('Try again on a faster connection', 'The file may be corrupted');
  } else if (error instanceof AuthError) {
    suggestions.push('Start the OAuth flow again via /api/google-oauth/start', 'Check your credentials');
  } else {
    suggestions.push('Try again', 'Contact support if the problem persists');
  }

  const isValidationError = error instanceof ValidationError;
  const isInstagramError = error instanceof InstagramApiError;
  const isAuthError = error instanceof AuthError;
  const clientMessage = error instanceof Error && (isValidationError || isInstagramError || isAuthError)
    ? errorMessage
    : 'Upload processing failed. Please try again.';

  return NextResponse.json(
    {
      success: false,
      error: clientMessage,
      errorType: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      logId,
      metadata: { duration },
      suggestions,
    },
    { status: isValidationError ? 400 : isInstagramError ? (error.statusCode || 500) : isAuthError ? 401 : 500 },
  );
}

// Reexport of the Bluesky handler (implemented in bluesky-handler.ts) so
// /api/upload-content imports every provider from this module.
export { handleBlueskyUpload } from '@/lib/upload/bluesky-handler';
export type { BlueskyUploadResponse } from '@/lib/upload/bluesky-handler';

// Reexport of the 3Speak handler (implemented in threespeak-handler.ts) so
// /api/upload-content imports every provider from this module.
export { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';
export type { ThreespeakUploadResponse } from '@/lib/upload/threespeak-handler';

// Reexport of the LinkedIn handler (implemented in linkedin-handler.ts) so
// /api/upload-content imports every provider from this module.
export { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
export type { LinkedinUploadResponse } from '@/lib/upload/linkedin-handler';
