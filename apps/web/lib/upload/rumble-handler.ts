import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { uploadRumbleVideo, RUMBLE_TITLE_MAX_LENGTH, RUMBLE_VIDEO_MAX_BYTES } from '@/lib/rumble';
import { accountFailure } from '@/lib/upload/account-error';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

interface RumbleAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface RumbleUploadResponse {
  success: boolean;
  results: RumbleAccountResult[];
}

function rejected(error: string): RumbleUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

export async function handleRumbleUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<RumbleUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'rumbleAccountIds');
  const titleRaw = formData.get('title');
  const descriptionRaw = formData.get('description');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one Rumble channel ID is required');
  if (typeof titleRaw !== 'string' || titleRaw.trim() === '') return rejected('Title is required');
  const title = titleRaw.trim();
  if (title.length > RUMBLE_TITLE_MAX_LENGTH) {
    return rejected(`Title exceeds the Rumble ${RUMBLE_TITLE_MAX_LENGTH}-character limit`);
  }
  if (typeof descriptionRaw !== 'string' || descriptionRaw.trim() === '') return rejected('Description is required');
  const description = descriptionRaw.trim();
  if (!(rawFile instanceof File)) return rejected('Video file is required');
  if (rawFile.size > RUMBLE_VIDEO_MAX_BYTES) return rejected('Video exceeds the Rumble 4GB limit');

  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 or MOV file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const filename = rawFile.name.endsWith('.mov') ? rawFile.name : 'video.mp4';

  const supabase = createSupabaseServiceClient();
  const results: RumbleAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'rumble', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        rememberDeadCredential('rumble', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'Rumble access token not found', 'token_missing'));
        continue;
      }

      const published = await uploadRumbleVideo({
        accessToken,
        channelId: accountId,
        title,
        description,
        video: new Blob([buffer], { type: contentType }),
        filename,
        contentType,
      });

      await touchSocialAccount(supabase, ownerUserId, 'rumble', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.videoId,
        ...(published.url === null ? {} : { permalink: published.url }),
      });
    } catch (error) {
      reportAccountUnauthorized('rumble', accountId, ownerUserId, error);
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  return { success: results.some((result) => result.success), results };
}
