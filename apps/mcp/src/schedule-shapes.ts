// Schedule/slot tool shapes, plus the generate_persona_video options
// shape and the URL-field helpers only it uses.
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet. tools.ts re-exports every name here, so existing import sites
// keep working.
import { z } from 'zod';

import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { VIDEO_LAYOUTS } from './limits.js';
import { personaVoiceField } from './voice-filters.js';

export const ListSchedulesShape = {};

export const ListSchedulesSchema = z.object(ListSchedulesShape);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const isoInstant = (what: string) =>
  z.string().regex(ISO_INSTANT, `${what} must be an ISO-8601 timestamp with a UTC offset, e.g. 2026-11-01T00:00:00-03:00.`);

export const ListPostsShape = {
  limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500. Ignored when from/to are given.'),
  from: isoInstant('from').optional().describe('Range mode (with to): start of the window, inclusive. Returns every post of any status with slot_at in [from, to) as a single slots list, plus truncated=true when the cap was hit. At most 62 days.'),
  to: isoInstant('to').optional().describe('Range mode (with from): end of the window, exclusive.'),
};

export const ListPostsSchema = z.object(ListPostsShape).refine((value) => (value.from === undefined) === (value.to === undefined), {
  message: 'from and to must be provided together.',
});

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
    .describe('The slot ID (the slotId field from list_posts or generate_persona_video).'),
};

export const GetSlotSchema = z.object(GetSlotShape);

export const UpdateSlotTitleShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from list_posts or generate_persona_video).'),
  title: z
    .string()
    .min(1, 'title is required')
    .describe('The new title text for the slot. Only a slot that has not started generating (status pending/awaiting) can be edited; published or mid-flight slots are rejected.'),
};

export const UpdateSlotTitleSchema = z.object(UpdateSlotTitleShape);

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

export const GeneratePersonaVideoOptionsShape = {
  faceless: z.boolean().optional().describe('Generate faceless (no face). With a persona this drops only the face — the persona voice and niche still apply. Without a persona it is REQUIRED.'),
  fullLipsync: z
    .boolean()
    .optional()
    .describe('Render the whole video as the persona talking: every narration window is lip-synced to the persona face. Requires a persona with a photo and lip-sync enabled, so it cannot be combined with faceless (there is no face to render). Narration over 60 seconds is rejected by the engine before any GPU spend. Full lip-sync costs 8 tokens per video at face quality ok and 15 tokens at very_good, instead of the hook-only 2 and 3 tokens.'),
  musicMood: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Background-music mood for the video: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood; an unknown mood is rejected by the engine with a 400. Works with faceless videos too.'),
  audioUrl: httpsUrlField('audioUrl').optional().describe('Public URL of custom audio for the videos (overrides the persona voice).'),
  imageId: z.string().min(1, 'imageId must be a non-empty string').optional().describe('Library image ID to use for every video (overrides the deterministic per-video selection; see list_persona_images).'),
  voiceId: personaVoiceField().optional().describe('Voice ID override: id or label from list_voices. Never type a provider prefix.'),
  webhookUrl: httpsUrlField('webhookUrl').optional().describe('Callback URL the server POSTs to when each video reaches a terminal state (completed/failed).'),
  videoAspect: z.enum(['9:16', '16:9', '1:1']).optional().describe('Frame shape. Overrides the persona when one is given; a post without a persona defaults to 9:16.'),
  videoLayout: z
    .enum(VIDEO_LAYOUTS)
    .optional()
    .describe('How the persona hook is composed with the video material (the agent images). Overrides the persona when one is given; a post without a persona defaults to "standard". Same render cost either way.'),
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
