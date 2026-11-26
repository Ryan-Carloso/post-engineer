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
  const aiLabelRaw = formData.get('aiLabel');
  if (aiLabelRaw !== null && aiLabelRaw !== 'true' && aiLabelRaw !== 'false') {
    return rejected('Invalid aiLabel. Use "true" or "false"');
  }
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
      const accessToken = await getValidPinterestAccessToken(supabase, ownerUserId, accountId);

      const text = { ...(title === '' ? {} : { title }), ...(description === '' ? {} : { description }) };
      const published = media.kind === 'image'
        ? await publishPinterestImage({ accessToken, boardId, image: media.buffer, contentType: media.contentType, aiLabel: aiLabelRaw === 'true', ...text })
        : await publishPinterestVideo({
          accessToken,
          boardId,
          video: media.buffer,
          filename,
          contentType: media.contentType,
          aiLabel: aiLabelRaw === 'true',
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
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  return { success: results.some((result) => result.success), results };
}
