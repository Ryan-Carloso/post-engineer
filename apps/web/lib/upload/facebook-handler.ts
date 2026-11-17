import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishFacebookMedia, FACEBOOK_TEXT_MAX_CHARS, FACEBOOK_VIDEO_MAX_BYTES } from '@/lib/facebook';
import { accountFailure } from '@/lib/upload/account-error';
import { reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { cleanupPublishMedia } from '@/lib/upload/publish-media';
import { stagePublishMedia } from '@/lib/upload/publish-media-file';

//---------------
// handleFacebookUpload — publishes the video or image to the user's Facebook Pages.
// Facebook fetches the media from a URL, so the file is stored
// on R2 first (presigned URL, lib/upload/publish-media.ts, same path as Threads).
// FormData (multipart, coming from the engine or the UI):
//   provider=facebook, video (File: MP4/MOV video or JPEG/PNG image), caption, facebookAccountIds (repeated),
//   userId (internal engine call only).
// The stored token is the Page access token (see lib/facebook.ts): Page
// tokens derived from a long-lived user token carry no expiry of their
// own, so there is no expiry_date check here.
//---------------

interface FacebookAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface FacebookUploadResponse {
  success: boolean;
  results: FacebookAccountResult[];
}

function rejected(error: string): FacebookUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

export async function handleFacebookUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<FacebookUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'facebookAccountIds');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one Facebook Page ID is required');
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') return rejected('Caption is required');
  const caption = captionRaw.trim();
  if (caption.length > FACEBOOK_TEXT_MAX_CHARS) {
    return rejected(`Caption exceeds the Facebook ${FACEBOOK_TEXT_MAX_CHARS}-character limit`);
  }
  const staged = await stagePublishMedia({
    provider: 'facebook',
    label: 'Facebook',
    rawFile,
    storagePathRaw: formData.get('videoStoragePath'),
    ownerUserId,
    maxVideoBytes: FACEBOOK_VIDEO_MAX_BYTES,
    maxVideoLabel: '4GB',
  });
  if (!staged.ok) return rejected(staged.error);
  const media = { kind: staged.kind, url: staged.url };

  const supabase = createSupabaseServiceClient();
  const results: FacebookAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'facebook', accountId);
      const pageAccessToken = tokens.access_token;

      if (typeof pageAccessToken !== 'string' || pageAccessToken === '') {
        results.push(accountFailure(accountId, 'Facebook Page token not found', 'token_missing'));
        continue;
      }

      const published = await publishFacebookMedia({
        pageAccessToken,
        pageId: accountId,
        media,
        description: caption,
        onPermalinkError: (error) => logger.warn('upload-content/facebook: permalink read failed', { accountId, error: String(error) }),
      });

      await touchSocialAccount(supabase, ownerUserId, 'facebook', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.postId,
        ...(published.permalink === null ? {} : { permalink: published.permalink }),
      });
    } catch (error) {
      reportAccountUnauthorized('facebook', accountId, ownerUserId, error);
      // A non-Error throw stays generic: accountFailure would surface a
      // thrown string as the message.
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  // Archive presign created no temp copy, so there is nothing to clean.
  if (!staged.usedArchive) {
    void cleanupPublishMedia('facebook');
  }

  return { success: results.some((result) => result.success), results };
}
