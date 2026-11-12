// Shapes for the singular MCP-first tools (Phase 1): generate_persona_video
// and validate_script. Kept in a new module so tools.ts stays under the
// file-size ratchet; index.ts registers both tools with direct server.tool
// calls using the handlers in tools-single-video.ts.
import { z } from 'zod';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { GeneratePersonaVideoOptionsShape } from './schedule-shapes.js';
import { RECIPE_SLUG_PATTERN } from './recipe-session.js';
import { EXPERIMENT_TARGET_PAIRS_MAX, EXPERIMENT_VARIANT_ID_PATTERN } from './limits.js';
import { VIDEO_TYPES, VIDEO_TYPE_ERROR_SUFFIX, unknownVideoTypeMessage } from './video-type.js';
import {
  MAX_IMAGES_MODE_MEDIAS,
  MAX_OVERLAY_BADGE_CHARS,
  MAX_OVERLAY_SUBTITLE_CHARS,
  MAX_OVERLAY_TITLE_CHARS,
} from './script-segments.js';

export const SegmentOverlayShape = z
  .object({
    title: z.string().min(1).max(MAX_OVERLAY_TITLE_CHARS).describe('The real place name, shown large on the card.'),
    subtitle: z.string().min(1).max(MAX_OVERLAY_SUBTITLE_CHARS).optional().describe('Address or area, shown under the title.'),
    badge: z.string().min(1).max(MAX_OVERLAY_BADGE_CHARS).optional().describe('Short highlight such as a price or a year, shown as a pill above the title.'),
  })
  .strict();

export const ScriptSegmentShape = {
  kind: z.enum(['hook', 'body', 'cta']).describe('Segment role: hook first, body in the middle, CTA last. Exactly one hook and one CTA.'),
  text: z.string().min(1, 'Each segment text must be non-empty').describe('Spoken text only: no placeholders, links, markdown, emoji or stage directions.'),
  media: z
    .array(z.object({ mediaId: z.string().min(1).optional(), url: z.string().min(1).optional(), overlay: SegmentOverlayShape.optional() }).strict())
    .max(MAX_IMAGES_MODE_MEDIAS)
    .optional()
    .describe('Photos for this segment, as a list. Each item is exactly one of mediaId (from upload_media) or url (a public image URL). One image per ~3s of speech (about 8 words), e.g. a 60s video needs about 20 images; split them across segments (at most 30). Full lip sync allows at most 6 images in total. Each photo is shown while its share of the segment is spoken: full frame on faceless videos, or a framed panel (about 38% of the frame) at the bottom where the persona face is on screen, so the face still shows. Optional overlay on an item: an info card (title, subtitle, badge), e.g. a place name, address and price; a caption spoken while a panel shows is placed above it, never on the photo.'),
};

/** Paired A/B experiment link (issue #476): one variant of one pair. */
export const ExperimentLinkShape = z
  .object({
    experimentId: z.string().uuid().describe('Experiment id from create_experiment / list_experiments.'),
    variantId: z.string().regex(EXPERIMENT_VARIANT_ID_PATTERN).describe('Variant slug, e.g. hook-aggressive.'),
    pair: z.number().int().min(1).max(EXPERIMENT_TARGET_PAIRS_MAX).describe('Pair number, 1 to the experiment targetPairs.'),
  })
  .strict();

export const GeneratePersonaVideoShape = {
  personaId: z
    .string()
    .min(1, 'personaId must be a non-empty string when provided')
    .optional()
    .describe('The persona to generate the video with. Omit for a faceless post with no persona: in that case set options.videoType to \'faceless\' and options.voiceId (or options.audioUrl).'),
  segments: z
    .array(z.object(ScriptSegmentShape).strict())
    .min(1, 'Provide at least one segment')
    .max(12, 'At most 12 segments per video')
    .describe('The complete script as segments: first hook, then body segments, last CTA. Total 60-200 words, body at least 30, CTA 5-20, hook 15-40 words before TTS. The hook must end with terminal punctuation. No LLM expands this script.'),
  title: z.string().min(1, 'title must be a non-empty string').max(100, 'title must be at most 100 characters').describe('Video title: the slot label sent to the web route (one call is one video).'),
  // Agent-supplied video description (issue #542 follow-up): REQUIRED —
  // the publish copy, sent top-level to the web route. The 5000-char cap
  // mirrors the engine's VideoParams.video_description max_length. There
  // is no fallback: a missing or blank description is rejected.
  description: z
    .string()
    .trim()
    .min(1, 'description must be a non-empty string')
    .max(5000)
    .describe('Video description: the publish copy sent to the web route (one call is one video). Required — there is no fallback to the title.'),
  language: z
    .string()
    .min(1)
    .max(32)
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .optional()
    .describe('Spoken language code — English only for now, e.g. en-US.'),
  providers: z
    .array(z.enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble']))
    .min(1, 'Provide at least one provider')
    .describe('Where to publish the video.'),
  youtubeAccountIds: z.array(z.string().min(1)).optional().describe('YouTube channel IDs (the channelId field from list_social_accounts).'),
  instagramAccountIds: z.array(z.string().min(1)).optional().describe('Instagram account IDs (the igUserId field from list_social_accounts).'),
  linkedinAccountIds: z.array(z.string().min(1)).optional().describe('LinkedIn account IDs (the providerAccountId field from list_social_accounts).'),
  blueskyAccountIds: z.array(z.string().min(1)).optional().describe('Bluesky DIDs (the did field from list_social_accounts).'),
  threadsAccountIds: z.array(z.string().min(1)).optional().describe('Threads account IDs (the providerAccountId field from list_social_accounts).'),
  facebookAccountIds: z.array(z.string().min(1)).optional().describe('Facebook Page IDs (the providerAccountId field from list_social_accounts).'),
  pinterestAccountIds: z.array(z.string().min(1)).optional().describe('Pinterest account IDs (the providerAccountId field from list_social_accounts).'),
  pinterestBoardId: z.string().min(1).optional().describe('Pinterest only: the board to publish the pin to (the id from list_pinterest_boards). Required when pinterest is selected.'),
  fanvueAccountIds: z.array(z.string().min(1)).optional().describe('Fanvue account IDs (the providerAccountId field from list_social_accounts).'),
  threespeakAccountIds: z.array(z.string().min(1)).optional().describe('3Speak Hive usernames (the providerAccountId field from list_social_accounts).'),
  rumbleAccountIds: z.array(z.string().min(1)).optional().describe('Rumble channel IDs (the providerAccountId field from list_social_accounts).'),
  mode: z
    .enum(['scheduled', 'asap'])
    .default('scheduled')
    .describe("Publish mode: 'scheduled' (default) slots the video across startAt + times; 'asap' publishes it the moment generation finishes, with no scheduled time — do not set startAt or times."),
  startAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'startAt must be a valid ISO datetime (e.g. "2026-10-02T20:00:00")',
    })
    .optional()
    .describe('When the publish slot may start: ISO datetime. Required unless mode is \'asap\'. The slot must be 3h-30d ahead.'),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Each time must be HH:MM in 24-hour format (e.g. "09:30", "20:00")'))
    .min(1, 'Provide at least one publish time')
    .optional()
    .describe('Daily publish times in HH:MM 24-hour format. Required unless mode is \'asap\'.'),
  timezone: z.string().min(1).default('UTC').describe('IANA timezone for a naive startAt and the HH:MM times, e.g. "Europe/Lisbon". Defaults to UTC.'),
  options: z.object(GeneratePersonaVideoOptionsShape).optional().describe('Generation options applied to this video.'),
  idempotencyKey: z.string().min(1).optional().describe('Idempotency key: retrying the call with the same key returns the original schedule (replayed: true) instead of generating again.'),
  experiment: ExperimentLinkShape.optional().describe('Join a paired A/B experiment (create_experiment): this video is one variant of one pair. The server rejects it when the pair partner differs in: the same providers and accounts, the same title, voice (id and audio URL), video type, video aspect and layout, paragraph number, face quality, language, niche and CTA text, and identical body and CTA segments, with a different hook. The pinned options.imageId is not stored, so it is not compared: pass the same imageId (or none) to both videos yourself. Prefer add_experiment_pair, which creates both videos of a pair.'),
  // Telemetry-only: the recipe the script came from. Never forwarded in the
  // request body (handleGeneratePersonaVideo builds it field by field);
  // recipe-session.ts sends it as the X-MCP-Recipe header.
  recipe: z
    .string()
    .regex(RECIPE_SLUG_PATTERN, 'recipe must be a recipe slug from list_prompts (lowercase letters, digits and hyphens)')
    .optional()
    .describe('The recipe slug (from list_prompts / get_prompt) this script was written with. Omit when the script was not written from a recipe.'),
};

export const GeneratePersonaVideoSchema = z.object(GeneratePersonaVideoShape).superRefine((value, ctx) => {
  // options itself is optional in the shape, but the mode is not: a call
  // with no options carries no videoType, and the web would reject it.
  // Fail here, locally, with the same values + costs message instead.
  if (value.options === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options', 'videoType'],
      message: `options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`,
    });
  }
});

export const ValidateScriptShape = {
  segments: z
    .array(z.object(ScriptSegmentShape).strict())
    .min(1, 'Provide at least one segment')
    .max(12, 'At most 12 segments per video')
    .describe('The complete script as segments to validate mechanically, without spending tokens.'),
  videoType: z
    .enum(VIDEO_TYPES, {
      error: (issue) => unknownVideoTypeMessage(issue.input),
    })
    .optional()
    .describe('The video mode the script is for: full_lipsync = media is optional (at most 6 images in total); hook_lipsync or faceless = images mode, which checks that every segment carries a media list, about one image per ~3s of speech (a 60s video needs about 20 images, at most 30). Omitted means hook_lipsync.'),
};

export const ValidateScriptSchema = z.object(ValidateScriptShape);
