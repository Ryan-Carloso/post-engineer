// Shapes for the singular MCP-first tools (Phase 1): generate_persona_video
// and validate_script. Kept in a new module so tools.ts stays under the
// file-size ratchet; index.ts registers both tools through
// registerSingleVideoTools in tools-single-video.ts.
import { z } from 'zod';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { GeneratePersonaVideosOptionsShape } from './schedule-shapes.js';

export const ScriptSegmentShape = {
  kind: z.enum(['hook', 'body', 'cta']).describe('Segment role: hook first, body in the middle, CTA last. Exactly one hook and one CTA.'),
  text: z.string().min(1, 'Each segment text must be non-empty').describe('Spoken text only: no placeholders, links, markdown, emoji or stage directions.'),
  media: z
    .object({ mediaId: z.string().min(1).optional(), url: z.string().min(1).optional() })
    .optional()
    .describe('Phase 1: media reference shape only (upload_media is Phase 2). Exactly one of mediaId or url.'),
  terms: z.array(z.string().min(1)).max(10).optional().describe('Stock terms for this segment, chosen by the agent. At most 10.'),
};

export const GeneratePersonaVideoShape = {
  personaId: z
    .string()
    .min(1, 'personaId must be a non-empty string when provided')
    .optional()
    .describe('The persona to generate the video with. Omit for a faceless post with no persona: in that case set options.faceless and options.voiceId (or options.audioUrl).'),
  segments: z
    .array(z.object(ScriptSegmentShape))
    .min(1, 'Provide at least one segment')
    .max(12, 'At most 12 segments per video')
    .describe('The complete script as segments: first hook, then body segments, last CTA. Total 60-200 words, body at least 30, CTA 5-20, hook 15-40 words before TTS. The hook must end with terminal punctuation. No LLM expands this script.'),
  title: z.string().min(1, 'title must be a non-empty string').describe('Video title; also the single topic sent to the web route (one call is one video).'),
  caption: z.string().optional().describe('Caption for the published post. Not spoken, so it may carry hashtags and links.'),
  language: z
    .string()
    .min(1)
    .max(32)
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .optional()
    .describe('Spoken language code — English only for now, e.g. en-US.'),
  providers: z
    .array(z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']))
    .min(1, 'Provide at least one provider')
    .describe('Where to publish the video.'),
  youtubeAccountIds: z.array(z.string().min(1)).optional().describe('YouTube channel IDs (the channelId field from list_social_accounts).'),
  instagramAccountIds: z.array(z.string().min(1)).optional().describe('Instagram account IDs (the igUserId field from list_social_accounts).'),
  linkedinAccountIds: z.array(z.string().min(1)).optional().describe('LinkedIn account IDs (the providerAccountId field from list_social_accounts).'),
  blueskyAccountIds: z.array(z.string().min(1)).optional().describe('Bluesky DIDs (the did field from list_social_accounts).'),
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
  options: z.object(GeneratePersonaVideosOptionsShape).optional().describe('Generation options applied to this video.'),
  idempotencyKey: z.string().min(1).optional().describe('Idempotency key: retrying the call with the same key returns the original schedule (replayed: true) instead of generating again.'),
};

export const GeneratePersonaVideoSchema = z.object(GeneratePersonaVideoShape);

export const ValidateScriptShape = {
  segments: z
    .array(z.object(ScriptSegmentShape))
    .min(1, 'Provide at least one segment')
    .max(12, 'At most 12 segments per video')
    .describe('The complete script as segments to validate mechanically, without spending tokens.'),
};

export const ValidateScriptSchema = z.object(ValidateScriptShape);
