// Shape for publish_video_direct (publish a user-provided video without
// generation or schedule). Kept in a new module so tools.ts stays under the
// file-size ratchet; tools.ts re-exports it so existing import sites
// (`./tools.js`) keep working.
import { z } from 'zod';
import { MAX_UPLOAD_VIDEO_GB } from './limits.js';

export const PublishVideoDirectShape = {
  provider: z
    .enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', '3speak'])
    .describe('The social platform to publish the video to.'),
  videoPath: z
    .string()
    .min(1, 'videoPath is required')
    .describe(
      `Local path to the video file (.mp4 or .mov, max ${MAX_UPLOAD_VIDEO_GB}GB). The video is published as-is: no generation, no schedule.`,
    ),
  accountIds: z
    .array(z.string().min(1))
    .min(1, 'At least one account ID is required')
    .describe(
      'Target accounts: the IDs from list_social_accounts (channel IDs for YouTube, IG user IDs for Instagram, DIDs for Bluesky, member IDs or org URNs for LinkedIn, user IDs for Threads, Page IDs for Facebook, Hive usernames for 3Speak).',
    ),
  title: z
    .string()
    .optional()
    .describe('YouTube only: required video title.'),
  description: z
    .string()
    .optional()
    .describe('YouTube only: required video description.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('YouTube only: required list of tags.'),
  privacyStatus: z
    .enum(['public', 'private', 'unlisted'])
    .optional()
    .describe('YouTube only: required privacy status.'),
  caption: z
    .string()
    .optional()
    .describe('Instagram/Bluesky/LinkedIn/Threads/Facebook/3Speak: required caption.'),
};

export const PublishVideoDirectSchema = z.object(PublishVideoDirectShape);
