import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import {
  initializeLinkedInVideoUpload,
  uploadLinkedInVideoParts,
  finalizeLinkedInVideoUpload,
  createLinkedInMemberPost,
  createLinkedInOrganizationPost,
} from '@/lib/linkedin';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

//---------------
// handleLinkedinUpload — publishes the video to the user's LinkedIn accounts
// (profile and/or organization pages). The target comes from linkedinAccountIds
// (repeated): if the value starts with "urn:li:organization:" it is a page
// post; otherwise it is a post on the member's profile.
// FormData (multipart, coming from the engine or the UI):
//   provider=linkedin, video (File), caption, linkedinAccountIds (repetido),
//   userId (internal engine call only).
//---------------

const ORG_URN_PREFIX = 'urn:li:organization:';

interface LinkedinAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  error?: string;
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
    return { success: false, results: [{ accountId: '', success: false, error: 'At least one LinkedIn account ID is required' }] };
  }
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') {
    return { success: false, results: [{ accountId: '', success: false, error: 'Caption is required' }] };
  }
  if (!(rawFile instanceof File)) {
    return { success: false, results: [{ accountId: '', success: false, error: 'Video file is required' }] };
  }

  const buffer = new Uint8Array(await rawFile.arrayBuffer());
  const supabase = createSupabaseServiceClient();
  const results: LinkedinAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      // Ownership: resolves only the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'linkedin', accountId);
      const accessToken = tokens.access_token;

      if (typeof accessToken !== 'string' || accessToken === '') {
        results.push({ accountId, success: false, error: 'LinkedIn token not found' });
        continue;
      }
      if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
        results.push({ accountId, success: false, error: 'LinkedIn token expired. Please reconnect the account.' });
        continue;
      }

      const isOrganization = accountId.startsWith(ORG_URN_PREFIX);

      // Video: initialize (owner = post target) → parts → finalize
      const ownerUrn = isOrganization ? accountId : `urn:li:person:${accountId}`;
      const upload = await initializeLinkedInVideoUpload(accessToken, ownerUrn, buffer.length, rawFile.type || 'video/mp4');
      await uploadLinkedInVideoParts(accessToken, upload.uploadInstructions, [buffer]);
      await finalizeLinkedInVideoUpload(accessToken, upload.video, upload.uploadToken);

      const postId = isOrganization
        ? await createLinkedInOrganizationPost(accessToken, accountId, upload.video, captionRaw.trim())
        : await createLinkedInMemberPost(accessToken, accountId, upload.video, captionRaw.trim());

      await touchSocialAccount(supabase, ownerUserId, 'linkedin', accountId);
      results.push({ accountId, success: true, postId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId, success: false, error: message });
    }
  }

  return { success: results.some((result) => result.success), results };
}
