import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishThreespeakVideo, THREESPEAK_VIDEO_MAX_BYTES } from '@/lib/threespeak';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

interface ThreespeakAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
}

export interface ThreespeakUploadResponse {
  success: boolean;
  results: ThreespeakAccountResult[];
}

function rejected(error: string): ThreespeakUploadResponse {
  return { success: false, results: [{ accountId: '', success: false, error }] };
}

export async function handleThreespeakUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<ThreespeakUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'threespeakAccountIds');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one 3Speak account is required');
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') return rejected('Caption is required');
  const caption = captionRaw.trim();
  if (!(rawFile instanceof File)) return rejected('Video file is required');
  if (rawFile.size > THREESPEAK_VIDEO_MAX_BYTES) return rejected('Video exceeds the 3Speak 2GB limit');

  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 or MOV file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';

  const supabase = createSupabaseServiceClient();
  const results: ThreespeakAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, '3speak', accountId);
      const postingKey = tokens.access_token;
      const username = typeof tokens.handle === 'string' ? tokens.handle : null;

      if (typeof postingKey !== 'string' || postingKey === '') {
        rememberDeadCredential('3speak', accountId, ownerUserId);
        results.push({ accountId, success: false, error: '3Speak posting key not found' });
        continue;
      }
      if (username === null || username === '') {
        results.push({ accountId, success: false, error: '3Speak Hive username not found' });
        continue;
      }

      const published = await publishThreespeakVideo({
        username,
        postingKey,
        video: buffer,
        filename: rawFile.name,
        contentType,
        caption,
      });

      await touchSocialAccount(supabase, ownerUserId, '3speak', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.videoId,
        ...(published.permalink === null ? {} : { permalink: published.permalink }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      reportAccountUnauthorized('3speak', accountId, ownerUserId, error);
      results.push({ accountId, success: false, error: message });
    }
  }

  return { success: results.some((result) => result.success), results };
}
