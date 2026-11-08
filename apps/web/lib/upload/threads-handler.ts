import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishThreadsVideo, THREADS_TEXT_MAX_CHARS, THREADS_VIDEO_MAX_BYTES } from '@/lib/threads';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { cleanupOldUploads, uploadToStorage } from '@/lib/upload/handlers';

//---------------
// handleThreadsUpload — publishes the video to the user's Threads accounts.
// Threads fetches the video from a URL, so the file goes through Supabase
// Storage first (signed URL, same path as Instagram).
// FormData (multipart, coming from the engine or the UI):
//   provider=threads, video (File), caption, threadsAccountIds (repeated),
//   userId (internal engine call only).
//---------------

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
  if (!(rawFile instanceof File)) return rejected('Video file is required');
  if (rawFile.size > THREADS_VIDEO_MAX_BYTES) return rejected('Video exceeds the Threads 1GB limit');

  // The stored file is served from a signed URL, so the bytes are checked
  // rather than the client-declared type: MP4 and MOV both carry `ftyp` at offset 4.
  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 or MOV file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const storagePath = `threads/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`;
  const videoUrl = await uploadToStorage(buffer, storagePath, contentType);

  const supabase = createSupabaseServiceClient();
  const results: ThreadsAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'threads', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        results.push(accountFailure(accountId, 'Threads token not found', 'token_missing'));
        continue;
      }
      if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
        results.push(accountFailure(accountId, 'Threads token expired. Please reconnect the account.', 'token_expired'));
        continue;
      }

      const published = await publishThreadsVideo({
        accessToken,
        userId: accountId,
        videoUrl,
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
      results.push(accountFailure(accountId, error));
    }
  }

  // Fire-and-forget: remove Threads media older than 24h from the bucket,
  // mirroring the Instagram handler — otherwise every publish stores
  // its video under `threads/` forever.
  cleanupOldUploads('threads');

  return { success: results.some((result) => result.success), results };
}
