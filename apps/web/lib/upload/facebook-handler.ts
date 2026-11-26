import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishFacebookMedia, FACEBOOK_TEXT_MAX_CHARS, FACEBOOK_VIDEO_MAX_BYTES } from '@/lib/facebook';
import { accountFailure } from '@/lib/upload/account-error';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { cleanupPublishMedia } from '@/lib/upload/publish-media';
import { stagePublishMedia } from '@/lib/upload/publish-media-file';

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
  const aiLabelRaw = formData.get('aiLabel');
  if (aiLabelRaw !== null && aiLabelRaw !== 'true' && aiLabelRaw !== 'false') {
    return rejected('Invalid aiLabel. Use "true" or "false"');
  }
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
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'facebook', accountId);
      const pageAccessToken = tokens.access_token;

      if (typeof pageAccessToken !== 'string' || pageAccessToken === '') {
        rememberDeadCredential('facebook', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'Facebook Page token not found', 'token_missing'));
        continue;
      }

      const published = await publishFacebookMedia({
        pageAccessToken,
        pageId: accountId,
        media,
        description: caption,
        aiLabel: aiLabelRaw === 'true',
        onPermalinkError: (error) => logger.warn('upload-content/facebook: permalink read failed', { accountId, error: String(error) }),
        onAiLabelError: (error) => logger.error('upload-content/facebook: AI label edit failed; the post is live without the AI disclosure', error, { accountId }),
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
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  if (!staged.usedArchive) {
    void cleanupPublishMedia('facebook');
  }

  return { success: results.some((result) => result.success), results };
}
