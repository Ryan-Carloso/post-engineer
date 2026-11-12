import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { touchSocialAccount } from '@/lib/social-accounts';
import { getValidFanvueAccessToken } from '@/lib/fanvue-tokens';
import { uploadVideoToFanvueVault } from '@/lib/fanvue-media';
import { createFanvuePost, FANVUE_POST_TEXT_MAX_LENGTH } from '@/lib/fanvue-posts';
import { reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

//---------------
// handleFanvueUpload — publishes the video as a subscribers-only post to
// the user's Fanvue accounts. Fanvue takes the file bytes (create upload
// session -> PUT to the presigned URL -> complete session -> POST /posts),
// so the handler passes the buffer straight through, never through
// Supabase Storage.
// FormData (multipart, coming from the engine or the UI):
//   provider=fanvue, video (File), title, description (or caption as
//   a description fallback, the shape the direct-publish MCP tool sends),
//   fanvueAccountIds (repeated), userId (internal engine call only).
// Content is title + description (description optional). It is validated,
// never truncated: the post text has a 5000-character API ceiling
// (FANVUE_POST_TEXT_MAX_LENGTH, see lib/fanvue-posts.ts), so a longer
// content is rejected instead of published cut off. Every post is
// subscribers-only (`audience: 'subscribers'`): Fanvue is an 18+ platform,
// so nothing is ever published public. The vault upload sends every part
// and waits for media `ready` before creating the post. The access token
// lives ~1 hour; an expired token is refreshed from the stored refresh
// token (which rotates — the new pair is persisted) before publishing.
//---------------

interface FanvueAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  error?: string;
  errorCode?: string;
}

export interface FanvueUploadResponse {
  success: boolean;
  results: FanvueAccountResult[];
}

function rejected(error: string): FanvueUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

export async function handleFanvueUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<FanvueUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'fanvueAccountIds');
  const titleRaw = formData.get('title');
  const descriptionRaw = formData.get('description');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one Fanvue account ID is required');
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  if (title === '') return rejected('A title is required');
  // The direct-publish shape sends the text as `caption`; the engine sends
  // it as `description`. Either is the post description, never both.
  const description =
    typeof descriptionRaw === 'string' && descriptionRaw.trim() !== ''
      ? descriptionRaw.trim()
      : typeof captionRaw === 'string'
        ? captionRaw.trim()
        : '';
  if (!(rawFile instanceof File)) return rejected('Video file is required');

  const content = description === '' ? title : `${title}\n\n${description}`;
  if (content.length > FANVUE_POST_TEXT_MAX_LENGTH) {
    return rejected(`Post text exceeds ${FANVUE_POST_TEXT_MAX_LENGTH} characters`);
  }

  // The stored file is checked by its bytes rather than the client-declared
  // type: MP4 carries `ftyp` at offset 4.
  const buffer = Buffer.from(await rawFile.arrayBuffer());
  if (buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return rejected('Video must be an MP4 file');

  const contentType = rawFile.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const filename = `fanvue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`;

  const supabase = createSupabaseServiceClient();
  const results: FanvueAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts; an expired
      // token is refreshed from the stored refresh token first.
      const accessToken = await getValidFanvueAccessToken(supabase, ownerUserId, accountId);

      const mediaUuid = await uploadVideoToFanvueVault({
        accessToken,
        video: buffer,
        filename,
        contentType,
      });
      const published = await createFanvuePost({ accessToken, mediaUuid, text: content });

      await touchSocialAccount(supabase, ownerUserId, 'fanvue', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.postId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('upload-content/fanvue: one account failed (continuing with the rest)', {
        metadata: { accountId, error: message },
      });
      reportAccountUnauthorized('fanvue', accountId, ownerUserId, error);
      // A non-Error throw stays generic: accountFailure would surface a
      // thrown string as the message.
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  return { success: results.some((result) => result.success), results };
}
