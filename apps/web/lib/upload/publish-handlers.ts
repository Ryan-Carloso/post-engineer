import 'server-only';

import type { SocialProvider } from '@/lib/contracts/providers';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import { handleBlueskyUpload } from '@/lib/upload/bluesky-handler';
import { handleInstagramUpload, handleYoutubeUpload } from '@/lib/upload/handlers';
import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { handleFanvueUpload } from '@/lib/upload/fanvue-handler';
import { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
import { handlePinterestUpload } from '@/lib/upload/pinterest-handler';
import { handleRumbleUpload } from '@/lib/upload/rumble-handler';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';

//---------------
// PUBLISH_HANDLERS — the publish handler of each network, for every
// caller that dispatches by provider (POST /api/upload-content and the
// publish-by-id path). A record, not a ternary chain: a new provider
// fails the typecheck until it has a handler, instead of falling through
// to the last branch of a chain.
//---------------

// What every handler response carries. No index signature: the handler
// responses are interfaces without one, and the extra fields (provider,
// logId, error) still flow through at runtime.
export interface PublishHandlerResponse {
  success: boolean;
  // Count of successful accounts in results.
  successCount?: number;
  results?: ContentUploadAccountResult[];
}

export type PublishHandler = (
  formData: FormData,
  ownerUserId: string,
  logId: string,
  startTime: number,
) => Promise<PublishHandlerResponse>;

export const PUBLISH_HANDLERS: Record<SocialProvider, PublishHandler> = {
  youtube: handleYoutubeUpload,
  instagram: handleInstagramUpload,
  bluesky: (formData, ownerUserId) => handleBlueskyUpload(formData, ownerUserId),
  linkedin: (formData, ownerUserId) => handleLinkedinUpload(formData, ownerUserId),
  threads: (formData, ownerUserId) => handleThreadsUpload(formData, ownerUserId),
  facebook: (formData, ownerUserId) => handleFacebookUpload(formData, ownerUserId),
  pinterest: (formData, ownerUserId) => handlePinterestUpload(formData, ownerUserId),
  '3speak': (formData, ownerUserId) => handleThreespeakUpload(formData, ownerUserId),
  rumble: (formData, ownerUserId) => handleRumbleUpload(formData, ownerUserId),
  fanvue: (formData, ownerUserId) => handleFanvueUpload(formData, ownerUserId),
};
