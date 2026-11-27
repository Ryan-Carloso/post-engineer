import { z } from 'zod';
import { MAX_UPLOAD_VIDEO_GB } from './limits.js';
import { FIRST_COMMENT_MAX_LENGTH } from './contracts/first-comment.js';
import { COMMENT_PROVIDERS, SOCIAL_PROVIDERS } from './contracts/providers.js';

export const FIRST_COMMENT_DESCRIPTION = `Optional: a comment the publisher posts on the new post right after it goes live, up to ${FIRST_COMMENT_MAX_LENGTH} characters. Posted on ${COMMENT_PROVIDERS.join(', ')}; the other networks skip it. A failed comment never fails the post: the account result carries a warnings code (FIRST_COMMENT_FAILED, FIRST_COMMENT_RECONNECT_REQUIRED when the account was connected before the comment permission existed and must be reconnected, FIRST_COMMENT_UNSUPPORTED_CHAT for a Telegram channel, where a bot cannot comment; groups get a reply, FIRST_COMMENT_TOO_LONG over the network limit). It cannot be pinned.`;

export const PublishVideoDirectShape = {
  provider: z
    .enum(SOCIAL_PROVIDERS)
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
      'Target accounts: the IDs from accounts (action: list) (channel IDs for YouTube, IG user IDs for Instagram, DIDs for Bluesky, member IDs or org URNs for LinkedIn, user IDs for Threads, Page IDs for Facebook, user IDs for Pinterest, Fanvue account IDs, Hive usernames for 3Speak, Channel IDs for Rumble).',
    ),
  title: z
    .string()
    .optional()
    .describe('YouTube/Rumble/Fanvue: required video title. Pinterest: pin title (optional).'),
  description: z
    .string()
    .optional()
    .describe('YouTube/Rumble/Fanvue: required video description. Pinterest: pin description (optional; caption is used when omitted).'),
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
    .describe('Instagram/Bluesky/LinkedIn/Threads/Facebook/3Speak: required caption. Pinterest: used as the pin description when description is omitted.'),
  boardId: z
    .string()
    .optional()
    .describe('Pinterest only: the board to publish the pin to (the id from accounts (action: list_boards)). Required for pinterest.'),
  firstComment: z
    .string()
    .max(FIRST_COMMENT_MAX_LENGTH, `firstComment must be at most ${FIRST_COMMENT_MAX_LENGTH} characters`)
    .optional()
    .describe(FIRST_COMMENT_DESCRIPTION),
  idempotencyKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Idempotency key: if the call times out or fails ambiguously, retry with the SAME key — the server returns the original publish result instead of posting the video again. Omitted: a key is generated per call.',
    ),
};

export const PublishVideoDirectSchema = z.object(PublishVideoDirectShape);
