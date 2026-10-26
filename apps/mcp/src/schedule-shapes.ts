// Schedule/slot tool shapes, plus the generate_persona_videos options
// shape and the URL-field helpers only it uses.
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet. tools.ts re-exports every name here, so existing import sites
// keep working.
import { z } from 'zod';

import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { VIDEO_LAYOUTS } from './limits.js';

export const ListSchedulesShape = {};

export const ListSchedulesSchema = z.object(ListSchedulesShape);

export const ListPostsShape = {
  limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500.'),
};

export const ListPostsSchema = z.object(ListPostsShape);

export const CancelScheduleShape = {
  scheduleId: z
    .string()
    .min(1, 'scheduleId is required')
    .describe(
      'The ID of the schedule to cancel. Unpublished slots (pending, generating, or ready) are removed and their prepaid tokens are refunded. A post already publishing or published is not recalled.',
    ),
};

export const CancelScheduleSchema = z.object(CancelScheduleShape);

export const GetSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from list_posts or generate_persona_videos).'),
};

export const GetSlotSchema = z.object(GetSlotShape);

export const UpdateSlotTopicShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from list_posts or generate_persona_videos).'),
  topic: z
    .string()
    .min(1, 'topic is required')
    .describe('The new topic text for the slot. Only a slot that has not started generating (status pending/awaiting) can be edited; published or mid-flight slots are rejected.'),
};

export const UpdateSlotTopicSchema = z.object(UpdateSlotTopicShape);

export const DeleteSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe(
      'The slot ID to delete. Only pending (awaiting) or failed slots can be deleted; published or mid-flight slots are rejected. The schedule\'s last slot cannot be deleted — delete the whole schedule with cancel_schedule instead.',
    ),
};

export const DeleteSlotSchema = z.object(DeleteSlotShape);

// Loopback hosts for which a plain http: media/webhook URL is tolerated
// (local dev callbacks). Anything else must be https so the URL's content
// never travels in cleartext.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isHttpsOrLoopbackHttp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
}

/** URL field for user-supplied media/webhook URLs: https, or http on loopback only. */
function httpsUrlField(fieldName: string) {
  return z
    .string()
    .url(`${fieldName} must be a valid URL`)
    .refine(isHttpsOrLoopbackHttp, {
      message: `${fieldName} must be an https URL (http is allowed only for loopback hosts like localhost)`,
    });
}

export const GeneratePersonaVideosOptionsShape = {
  faceless: z.boolean().optional().describe('Generate faceless (no face). With a persona this drops only the face — the persona voice, niche and script prompt still apply. Without a persona it is REQUIRED.'),
  facelessMaterial: z
    .enum(['broll', 'svg'])
    .optional()
    .describe('What fills the video, with or without a face: "broll" = real stock footage only, "svg" = drawn illustrations only. The two never mix. Defaults to "broll".'),
  audioUrl: httpsUrlField('audioUrl').optional().describe('Public URL of custom audio for the videos (overrides the persona voice).'),
  imageId: z.string().min(1, 'imageId must be a non-empty string').optional().describe('Library image ID to use for every video (overrides the deterministic per-video selection; see list_persona_images).'),
  scriptPrompt: z.string().optional().describe('Script prompt override applied to every video in this call.'),
  scriptPrompts: z.array(z.string().min(1)).optional().describe('Per-topic script prompt overrides; must have one entry per topic.'),
  voiceId: z.string().min(1, 'voiceId must be a non-empty string').optional().describe('Voice ID override (see list_voices).'),
  webhookUrl: httpsUrlField('webhookUrl').optional().describe('Callback URL the server POSTs to when each video reaches a terminal state (completed/failed).'),
  videoAspect: z.enum(['9:16', '16:9']).optional().describe('Frame shape. Overrides the persona when one is given; a post without a persona defaults to 9:16.'),
  videoLayout: z
    .enum(VIDEO_LAYOUTS)
    .optional()
    .describe('How the persona hook is composed with the video material (facelessMaterial: real clips or drawings). Overrides the persona when one is given; a post without a persona defaults to "standard". Same render cost either way.'),
  paragraphNumber: z.number().int().min(1).max(10).optional().describe('Paragraph count (1-10). Overrides the persona when one is given.'),
  language: z
    .string()
    .min(1)
    .max(32)
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .optional()
    .describe('Spoken language code — English only for now, e.g. en-US. Overrides the persona when one is given.'),
  niche: z.string().min(1).max(300).optional().describe('Content niche. Overrides the persona when one is given.'),
};
