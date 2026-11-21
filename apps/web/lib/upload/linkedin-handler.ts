import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import {
  LINKEDIN_VIDEO_MAX_BYTES,
  initializeLinkedInVideoUpload,
  uploadLinkedInVideoParts,
  finalizeLinkedInVideoUpload,
  createLinkedInMemberPost,
  createLinkedInOrganizationPost,
  uploadLinkedInImage,
} from '@/lib/linkedin';
import { accountFailure } from '@/lib/upload/account-error';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import { MAX_IMAGE_UPLOAD_BYTES, sniffPublishMedia } from '@/lib/upload/publish-media-file';

const ORG_URN_PREFIX = 'urn:li:organization:';

interface LinkedinAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  error?: string;
  errorCode?: string;
}

export interface LinkedinUploadResponse {
  success: boolean;
  results: LinkedinAccountResult[];
}

export async function handleLinkedinUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<LinkedinUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'linkedinAccountIds');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (accountIds.length === 0) {
    return { success: false, results: [accountFailure('', 'At least one LinkedIn account ID is required', 'publish_rejected')] };
  }
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') {
    return { success: false, results: [accountFailure('', 'Caption is required', 'publish_rejected')] };
  }
  if (!(rawFile instanceof File)) {
    return { success: false, results: [accountFailure('', 'A video or image file is required', 'publish_rejected')] };
  }

  if (rawFile.size > LINKEDIN_VIDEO_MAX_BYTES) {
    return { success: false, results: [accountFailure('', 'LinkedIn video exceeds the 5 GB limit', 'publish_rejected')] };
  }

  const buffer = new Uint8Array(await rawFile.arrayBuffer());
  const sniffed = sniffPublishMedia(Buffer.from(buffer), rawFile.type);
  const isImage = sniffed !== null && sniffed.kind === 'image';
  if (isImage && buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    return { success: false, results: [accountFailure('', 'Image exceeds the 8 MB limit', 'publish_rejected')] };
  }
  const supabase = createSupabaseServiceClient();
  const results: LinkedinAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'linkedin', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        rememberDeadCredential('linkedin', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'LinkedIn token not found', 'token_missing'));
        continue;
      }
      if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
        rememberDeadCredential('linkedin', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'LinkedIn token expired. Please reconnect the account.', 'token_expired'));
        continue;
      }

      const isOrganization = accountId.startsWith(ORG_URN_PREFIX);

      const ownerUrn = isOrganization ? accountId : `urn:li:person:${accountId}`;
      let mediaUrn: string;
      if (isImage) {
        mediaUrn = await uploadLinkedInImage(accessToken, ownerUrn, buffer);
      } else {
        const upload = await initializeLinkedInVideoUpload(accessToken, ownerUrn, buffer.length, rawFile.type || 'video/mp4');
        await uploadLinkedInVideoParts(accessToken, upload.uploadInstructions, [buffer]);
        await finalizeLinkedInVideoUpload(accessToken, upload.video, upload.uploadToken);
        mediaUrn = upload.video;
      }

      const postId = isOrganization
        ? await createLinkedInOrganizationPost(accessToken, accountId, mediaUrn, captionRaw.trim())
        : await createLinkedInMemberPost(accessToken, accountId, mediaUrn, captionRaw.trim());

      await touchSocialAccount(supabase, ownerUserId, 'linkedin', accountId);
      results.push({ accountId, success: true, postId });
    } catch (error) {
      reportAccountUnauthorized('linkedin', accountId, ownerUserId, error);
      results.push(accountFailure(accountId, error));
    }
  }

  return { success: results.some((result) => result.success), results };
}
