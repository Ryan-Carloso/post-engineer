import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishFacebookVideo, FACEBOOK_TEXT_MAX_CHARS, FACEBOOK_VIDEO_MAX_BYTES } from '@/lib/facebook';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { cleanupOldUploads, uploadToStorage } from '@/lib/upload/handlers';

//---------------
// handleFacebookUpload — publishes the video to the user's Facebook Pages.
// Facebook fetches the video from a URL, so the file goes through Supabase
// Storage first (signed URL, same path as Threads).
// FormData (multipart, coming from the engine or the UI):
//   provider=facebook, video (File), caption, facebookAccountIds (repeated),
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
}

export interface FacebookUploadResponse {
  success: boolean;
  results: FacebookAccountResult[];
}

function rejected(error: string): FacebookUploadResponse {
  return { success: false, results: [{ accountId: '', success: false, error }] };
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
  if (!(rawFile instanceof File)) return rejected('Video file is required');
  if (rawFile.size > FACEBOOK_VIDEO_MAX_BYTES) return rejected('Video exceeds the Facebook 4GB limit');

  // The stored file is served from a signed URL, so the bytes are checked
  // rather than the client-declared type: MP4 and MOV both carry `ftyp` at offset 4.
  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 or MOV file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const storagePath = `facebook/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`;
  const videoUrl = await uploadToStorage(buffer, storagePath, contentType);

  const supabase = createSupabaseServiceClient();
  const results: FacebookAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'facebook', accountId);
      const pageAccessToken = tokens.access_token;

      if (typeof pageAccessToken !== 'string' || pageAccessToken === '') {
        results.push({ accountId, success: false, error: 'Facebook Page token not found' });
        continue;
      }

      const published = await publishFacebookVideo({
        pageAccessToken,
        pageId: accountId,
        videoUrl,
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId, success: false, error: message });
    }
  }

  // Fire-and-forget: remove Facebook media older than 24h from the bucket,
  // mirroring the Threads handler — otherwise every publish stores
  // its video under `facebook/` forever.
  cleanupOldUploads('facebook');

  return { success: results.some((result) => result.success), results };
}
