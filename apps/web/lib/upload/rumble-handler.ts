import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { uploadRumbleVideo, RUMBLE_TITLE_MAX_LENGTH, RUMBLE_VIDEO_MAX_BYTES } from '@/lib/rumble';
import { reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

//---------------
// handleRumbleUpload — publishes the video to the user's Rumble channels
// via the Simple Upload API. Unlike Facebook/Threads, Rumble takes the
// video bytes directly (multipart), so the file is forwarded without a
// Supabase Storage round-trip.
// FormData (multipart, coming from the engine or the UI):
//   provider=rumble, video (File), title, description,
//   rumbleAccountIds (repeated; Rumble channel ids),
//   userId (internal engine call only).
// The stored token is the manually issued 40-char Simple Upload API
// access token (see lib/rumble.ts): there is no OAuth, no expiry to
// check, and no way to validate it without uploading — a wrong token
// surfaces here as an invalid_token error and is reported for reconnect.
//---------------

interface RumbleAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
}

export interface RumbleUploadResponse {
  success: boolean;
  results: RumbleAccountResult[];
}

function rejected(error: string): RumbleUploadResponse {
  return { success: false, results: [{ accountId: '', success: false, error }] };
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

  // The bytes are checked rather than the client-declared type: MP4 and
  // MOV both carry `ftyp` at offset 4.
  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 or MOV file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const filename = rawFile.name.endsWith('.mov') ? rawFile.name : 'video.mp4';

  const supabase = createSupabaseServiceClient();
  const results: RumbleAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts. The channel id
      // is the account id itself (stored as provider_account_id at connect).
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'rumble', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        results.push({ accountId, success: false, error: 'Rumble access token not found' });
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      reportAccountUnauthorized('rumble', accountId, ownerUserId, error);
      results.push({ accountId, success: false, error: message });
    }
  }

  return { success: results.some((result) => result.success), results };
}
