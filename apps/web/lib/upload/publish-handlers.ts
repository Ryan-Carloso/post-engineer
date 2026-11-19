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
import { handleTelegramUpload } from '@/lib/upload/telegram-handler';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';

export interface PublishHandlerResponse {
  success: boolean;
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
  telegram: (formData, ownerUserId) => handleTelegramUpload(formData, ownerUserId),
};
