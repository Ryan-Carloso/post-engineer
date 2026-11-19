import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishThreadsMedia, THREADS_TEXT_MAX_CHARS, THREADS_VIDEO_MAX_BYTES } from '@/lib/threads';
import { accountFailure } from '@/lib/upload/account-error';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { cleanupPublishMedia } from '@/lib/upload/publish-media';
import { stagePublishMedia } from '@/lib/upload/publish-media-file';

interface ThreadsAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface ThreadsUploadResponse {
  success: boolean;
  results: ThreadsAccountResult[];
}

function rejected(error: string): ThreadsUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

export async function handleThreadsUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<ThreadsUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'threadsAccountIds');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one Threads account ID is required');
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') return rejected('Caption is required');
  const caption = captionRaw.trim();
  if (caption.length > THREADS_TEXT_MAX_CHARS) {
    return rejected(`Caption exceeds the Threads ${THREADS_TEXT_MAX_CHARS}-character limit`);
  }
  const staged = await stagePublishMedia({
    provider: 'threads',
    label: 'Threads',
    rawFile,
    storagePathRaw: formData.get('videoStoragePath'),
    ownerUserId,
    maxVideoBytes: THREADS_VIDEO_MAX_BYTES,
    maxVideoLabel: '1GB',
  });
  if (!staged.ok) return rejected(staged.error);
  const media = { kind: staged.kind, url: staged.url };

  const supabase = createSupabaseServiceClient();
  const results: ThreadsAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'threads', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        rememberDeadCredential('threads', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'Threads token not found', 'token_missing'));
        continue;
      }
      if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
        rememberDeadCredential('threads', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'Threads token expired. Please reconnect the account.', 'token_expired'));
        continue;
      }

      const published = await publishThreadsMedia({
        accessToken,
        userId: accountId,
        media,
        text: caption,
        onPermalinkError: (error) => logger.warn('upload-content/threads: permalink read failed', { accountId, error: String(error) }),
      });

      await touchSocialAccount(supabase, ownerUserId, 'threads', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.postId,
        ...(published.permalink === null ? {} : { permalink: published.permalink }),
      });
    } catch (error) {
      reportAccountUnauthorized('threads', accountId, ownerUserId, error);
      results.push(accountFailure(accountId, error));
    }
  }

  if (!staged.usedArchive) {
    void cleanupPublishMedia('threads');
  }

  return { success: results.some((result) => result.success), results };
}
