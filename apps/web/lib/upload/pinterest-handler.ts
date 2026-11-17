import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { touchSocialAccount } from '@/lib/social-accounts';
import { getValidPinterestAccessToken } from '@/lib/pinterest-tokens';
import {
  publishPinterestImage,
  publishPinterestVideo,
  PINTEREST_TITLE_MAX_CHARS,
  PINTEREST_DESCRIPTION_MAX_CHARS,
  PINTEREST_VIDEO_MAX_BYTES,
} from '@/lib/pinterest';
import { reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { MAX_IMAGE_UPLOAD_BYTES, sniffPublishMedia } from '@/lib/upload/publish-media-file';

//---------------
// handlePinterestUpload — publishes the video or image as a Pin to the
// user's Pinterest boards. Pinterest takes the file bytes: a video goes
// register -> S3 presigned upload -> poll -> create Pin; a JPEG/PNG image
// rides in the Pin body (image_base64). The handler passes the buffer
// straight through, never through Supabase Storage.
// FormData (multipart, coming from the engine or the UI):
//   provider=pinterest, video (File: a video, or a JPEG/PNG image), title, description (or caption as
//   a description fallback, the shape the direct-publish MCP tool sends),
//   boardId (one board for the whole batch — a schedule carries exactly
//   one pinterest_board_id), pinterestAccountIds (repeated),
//   coverImageUrl (optional), userId (internal engine call only).
// Title/description are validated, never truncated: over the Pinterest
// ceilings the whole request is rejected. The access token lives 30
// days; an expired token is refreshed from the stored refresh token
// (which rotates — the new pair is persisted) before publishing.
//---------------

interface PinterestAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface PinterestUploadResponse {
  success: boolean;
  results: PinterestAccountResult[];
}

function rejected(error: string): PinterestUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

export async function handlePinterestUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<PinterestUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'pinterestAccountIds');
  const boardIdRaw = formData.get('boardId');
  const titleRaw = formData.get('title');
  const descriptionRaw = formData.get('description');
  const captionRaw = formData.get('caption');
  const coverImageUrlRaw = formData.get('coverImageUrl');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) return rejected('At least one Pinterest account ID is required');
  if (typeof boardIdRaw !== 'string' || boardIdRaw.trim() === '') {
    return rejected('A Pinterest board is required (boardId)');
  }
  const boardId = boardIdRaw.trim();
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  if (title.length > PINTEREST_TITLE_MAX_CHARS) {
    return rejected(`Title exceeds the Pinterest ${PINTEREST_TITLE_MAX_CHARS}-character limit`);
  }
  // The direct-publish shape sends the text as `caption`; the engine sends
  // it as `description`. Either is the pin description, never both.
  const description =
    typeof descriptionRaw === 'string' && descriptionRaw.trim() !== ''
      ? descriptionRaw.trim()
      : typeof captionRaw === 'string'
        ? captionRaw.trim()
        : '';
  if (description.length > PINTEREST_DESCRIPTION_MAX_CHARS) {
    return rejected(`Description exceeds the Pinterest ${PINTEREST_DESCRIPTION_MAX_CHARS}-character limit`);
  }
  if (!(rawFile instanceof File)) return rejected('A video or image file is required');
  if (rawFile.size > PINTEREST_VIDEO_MAX_BYTES) return rejected('Video exceeds the Pinterest 2GB limit');

  // The file is checked by its bytes rather than the client-declared type:
  // MP4 and MOV both carry `ftyp` at offset 4; JPEG and PNG their signature.
  const media = sniffPublishMedia(Buffer.from(await rawFile.arrayBuffer()), rawFile.type);
  if (media === null) return rejected('File must be an MP4 or MOV video, or a JPEG or PNG image');
  if (media.kind === 'image' && media.buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    return rejected('Image exceeds the 8 MB limit');
  }
  const filename = `pinterest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${media.extension}`;
  const coverImageUrl =
    typeof coverImageUrlRaw === 'string' && coverImageUrlRaw.trim() !== '' ? coverImageUrlRaw.trim() : undefined;

  const supabase = createSupabaseServiceClient();
  const results: PinterestAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts; an expired
      // token is refreshed from the stored refresh token first.
      const accessToken = await getValidPinterestAccessToken(supabase, ownerUserId, accountId);

      const text = { ...(title === '' ? {} : { title }), ...(description === '' ? {} : { description }) };
      const published = media.kind === 'image'
        ? await publishPinterestImage({ accessToken, boardId, image: media.buffer, contentType: media.contentType, ...text })
        : await publishPinterestVideo({
          accessToken,
          boardId,
          video: media.buffer,
          filename,
          contentType: media.contentType,
          ...text,
          ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
        });

      await touchSocialAccount(supabase, ownerUserId, 'pinterest', accountId);
      results.push({
        accountId,
        success: true,
        postId: published.pinId,
        permalink: published.permalink,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('upload-content/pinterest: one account failed (continuing with the rest)', {
        metadata: { accountId, error: message },
      });
      reportAccountUnauthorized('pinterest', accountId, ownerUserId, error);
      // A non-Error throw stays generic: accountFailure would surface a
      // thrown string as the message.
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  return { success: results.some((result) => result.success), results };
}
