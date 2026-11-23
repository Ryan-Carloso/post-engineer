import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { UploadContentResponseSchema } from './media.js';
import { UUID } from './metrics.js';
import { PersonaCtaSchema } from './personas.js';
import { SOCIAL_PROVIDERS } from './providers.js';
import { ScheduleWarningSchema } from './schedule-warnings.js';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, UPLOAD_CONTENT_TYPE_MESSAGE, isImageUploadContentType } from './upload-types.js';

export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export const VIDEO_TYPE_ERROR_SUFFIX =
  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';

export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}

export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

export const VIDEO_TRANSITION_MODES = ['Shuffle', 'FadeIn', 'FadeOut', 'SlideIn', 'SlideOut', 'Crossfade'] as const;
export type VideoTransitionMode = (typeof VIDEO_TRANSITION_MODES)[number];

export const SUBTITLE_POSITIONS = ['top', 'center', 'bottom', 'custom'] as const;
export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number];

export const MAX_SEGMENTS = 12;
export const MAX_IMAGES_MODE_MEDIAS = 30;
export const HOOK_MIN_SECONDS = 8;
export const HOOK_MAX_SECONDS = 12;
export const MIN_REQUESTED_PHOTO_SECONDS = 0.5;
export const MAX_REQUESTED_PHOTO_SECONDS = 6;

export const MIN_LIPSYNC_PHOTOS = 2;
export const MAX_LIPSYNC_PHOTOS = 5;
export const LIPSYNC_WINDOW_SECONDS = 12;

export const MAX_REPORTED_ISSUES = 20;

export const MAX_BATCH_VIDEOS = 12;
export const BATCH_KEY_MAX_LENGTH = 100;
export const BATCH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export const DRAFT_KINDS = ['post', 'script'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const PUBLISH_NETWORKS = SOCIAL_PROVIDERS;
export type PublishNetwork = (typeof PUBLISH_NETWORKS)[number];

export const DRAFT_MAX_INPUT_CHARS = 10000;

export * from './upload-types.js';

export const segmentOverlaySchema = z
  .object({
    title: z.string(),
    subtitle: z.string().optional(),
    badge: z.string().optional(),
  })
  .strict();

export const segmentsRequestSchema = z.array(
  z
    .object({
      kind: z.enum(['hook', 'content']),
      text: z.string(),
      cta: z.boolean().optional(),
      media: z
        .array(
          z
            .object({
              mediaId: z.string().optional(),
              url: z.string().optional(),
              overlay: segmentOverlaySchema.optional(),
              duration: z
                .number()
                .min(MIN_REQUESTED_PHOTO_SECONDS)
                .max(MAX_REQUESTED_PHOTO_SECONDS)
                .optional(),
            })
            .strict(),
        )
        .max(MAX_IMAGES_MODE_MEDIAS)
        .optional(),
    })
    .strict(),
).max(MAX_SEGMENTS);

export const lipsyncPhotosRequestSchema = z.array(
  z
    .object({
      mediaId: z.string().optional(),
      url: z.string().optional(),
    })
    .strict(),
);

const PublishingScheduleSchema = z.object({
  startAt: z.string(),
  times: z.array(z.string()),
  timezone: z.string(),
});

const PublishingSchema = z.object({
  mode: z.enum(['scheduled', 'asap']).optional(),
  providers: z.array(z.string()).max(MAX_REPORTED_ISSUES),
  accounts: z.record(z.string(), z.array(z.string())).optional(),
  pinterestBoardId: z.string().max(100).optional(),
  schedule: PublishingScheduleSchema.optional(),
  timezone: z.string().optional(),
});

const OptionsSchema = z
  .object({
    videoType: z.enum(VIDEO_TYPES, {
      error: (issue) => (issue.input === undefined ? `options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}` : unknownVideoTypeMessage(issue.input)),
    }),
    musicMood: z.string().min(1).max(64).optional().describe('Background-music mood for the video: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood; an unknown mood is rejected with a 400 naming the valid moods. Works with faceless videos too.'),
    audioUrl: z.string().optional(),
    imageId: z.string().optional(),
    segments: segmentsRequestSchema.optional(),
    lipsyncPhotos: lipsyncPhotosRequestSchema.optional(),
    webhookUrl: z.string().optional(),
    voiceId: z.string().optional(),
    videoAspect: z.enum(['9:16', '16:9', '1:1']).optional(),
    videoLayout: z.enum(['standard', 'react']).optional(),
    hookPanel: z.boolean().optional(),
    paragraphNumber: z.number().int().min(1).max(10).optional(),
    language: z.string().optional(),
    niche: z.string().optional(),
    videoClipDuration: z.number().int().min(1).max(60).optional().describe('Pacing weight, not exact seconds: maximum seconds per photo (1-60). Omitted keeps the 2s default. The engine fits photo holds to the real spoken audio, stretching each photo at most 1.5x its pace, so a larger value means slower holds and fewer photos, not a longer video. A/B test it: change one knob at a time between videos of the same niche and compare their results.'),
    videoTransitionMode: z.enum(VIDEO_TRANSITION_MODES).optional().describe('Transition between clips: Shuffle varies it per clip, Crossfade blends segment photos over 0.5s, FadeIn/FadeOut fade each clip in/out, SlideIn/SlideOut slide it in/out. Omitted keeps hard cuts. A/B test it like videoClipDuration: one knob at a time, same niche, and compare results.'),
    videoVariationSeed: z.number().int().optional().describe('Seed for per-video variation of the segment photos zoom direction; the same seed repeats the same pattern. Omitted keeps the fixed in/out alternation. Change it for a different look of the same script without changing pacing.'),
    subtitlePosition: z.enum(SUBTITLE_POSITIONS).optional().describe('Caption placement: top near the top of the frame, center in the middle, bottom near the bottom, custom at subtitleCustomPosition percent from the top. Omitted keeps the engine default.'),
    subtitleCustomPosition: z.number().int().min(0).max(100).optional().describe('Caption height as percent from the top (0-100). Only with subtitlePosition "custom"; rejected otherwise.'),
  })
  .optional();

export const GenerateAndScheduleBodySchema = z.object({
  personaId: z.string().optional(),
  title: z.string().max(100, 'title must be at most 100 characters.'),
  description: z.string({ error: (issue) => (issue.input === undefined ? 'description is required: the publish copy for this video.' : undefined) }).min(1, 'description must be a non-empty string: the publish copy for this video.').max(5000, 'description must be at most 5000 characters.'),
  publishing: PublishingSchema,
  options: OptionsSchema,
  idempotencyKey: z.string().optional(),
  promptVersionId: z.string().uuid('promptVersionId must be the versionId returned with the prompt.').optional(),
  cta: PersonaCtaSchema.nullable().optional(),
});

export type GenerateAndScheduleBody = z.infer<typeof GenerateAndScheduleBodySchema>;

export const GenerateSlotResultSchema = z.object({
  slotId: z.string(),
  slotAt: z.string(),
  title: z.string(),
  taskId: z.string().nullable(),
  status: z.string(),
  errorCode: z.string().optional(),
  tokensRefunded: z.boolean().optional(),
});

export const GenerateAndScheduleWarningSchema = ScheduleWarningSchema;

export const GenerateAndScheduleResponseSchema = z.object({
  success: z.literal(true),
  schedule: z.object({
    id: z.string(),
    mode: z.enum(['scheduled', 'asap']),
  }),
  slots: z.array(GenerateSlotResultSchema),
  replayed: z.boolean(),
  warnings: z.array(GenerateAndScheduleWarningSchema).optional(),
});

export const ValidateScriptBodySchema = z.object({
  segments: z.unknown().optional(),
  videoType: z
    .enum(VIDEO_TYPES, {
      error: (issue) => unknownVideoTypeMessage(issue.input),
    })
    .optional(),
});

export const ValidateScriptResponseSchema = z.object({
  success: z.literal(true),
  valid: z.literal(true),
  segmentCount: z.number(),
  totalWords: z.number(),
  hookWords: z.number(),
  contentWords: z.number(),
  mediaCount: z.number(),
  hookWindowSeconds: z.object({
    min: z.literal(HOOK_MIN_SECONDS),
    max: z.literal(HOOK_MAX_SECONDS),
  }),
  measuredDurationSeconds: z.null(),
  measured: z.literal('pending'),
  measuredReason: z.string(),
});

export const ScoreDraftBodySchema = z.object({
  draft: z
    .string({
      error: (issue) => (issue.code === 'invalid_type' ? 'draft is required and must be a non-empty string.' : undefined),
    })
    .min(1, 'draft is required and must be a non-empty string.')
    .max(DRAFT_MAX_INPUT_CHARS, `draft must be at most ${DRAFT_MAX_INPUT_CHARS} characters.`)
    .refine((value) => value.trim().length > 0, { message: 'draft is required and must be a non-empty string.' }),
  network: z
    .enum(PUBLISH_NETWORKS, {
      error: () => `network must be one of ${PUBLISH_NETWORKS.map((n) => `"${n}"`).join(', ')} when given.`,
    })
    .optional(),
  personaId: z
    .string()
    .refine((value) => UUID.test(value), { message: 'personaId must be a uuid when given.' })
    .optional(),
  kind: z
    .enum(DRAFT_KINDS, {
      error: () => 'kind must be "post" or "script" when given.',
    })
    .optional(),
});

export const DraftScoreReasonSchema = z.object({ rule: z.string(), detail: z.string(), points: z.number() });

export const TopAngleSchema = z.object({ angle: z.string(), engagement: z.number(), posts: z.number() });

export const DraftBaselineSchema = z.object({
  postsMeasured: z.number(),
  topAngles: z.array(TopAngleSchema),
  medianEngagement: z.number().nullable(),
  bestEngagement: z.number().nullable(),
  truncated: z.boolean(),
});

export const PublishCheckSchema = z.object({ network: z.enum(PUBLISH_NETWORKS), ok: z.boolean(), failures: z.array(z.string()), warnings: z.array(z.string()) });

export const DraftCountsSchema = z.object({ chars: z.number(), words: z.number(), hashtags: z.number(), links: z.number(), firstLineWords: z.number(), slopHits: z.array(z.string()), topThemeMatch: z.string().nullable() });

export const ScoreDraftResponseSchema = z.object({
  success: z.literal(true),
  score: z.number(),
  reasons: z.array(DraftScoreReasonSchema),
  counts: DraftCountsSchema,
  baseline: DraftBaselineSchema,
  publishCheck: PublishCheckSchema.nullable(),
});

export const BatchDiscountBodySchema = z
  .object({
    batchKey: z.string().min(1).max(BATCH_KEY_MAX_LENGTH).regex(BATCH_KEY_PATTERN, 'batchKey may only contain letters, digits, "-" and "_".'),
    scheduleIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_VIDEOS),
  })
  .strict();

export const BatchDiscountFreeVideoSchema = z.object({ scheduleId: z.string(), slotId: z.string(), discountTokens: z.number() });

export const BatchDiscountResponseSchema = z.object({
  success: z.literal(true),
  batchId: z.string(),
  videos: z.number(),
  faceVideos: z.number(),
  earnedFreeVideos: z.number(),
  freeVideos: z.array(BatchDiscountFreeVideoSchema),
  discountTokens: z.number(),
  chargedTokens: z.number(),
  warnings: z.array(z.string()),
});

export const MintVideoUploadBodySchema = z.object({
  contentType: z.enum(UPLOAD_CONTENT_TYPES, {
    error: () => UPLOAD_CONTENT_TYPE_MESSAGE,
  }),
  sizeBytes: z.number({ error: (issue) => (issue.code === 'invalid_type' ? 'sizeBytes must be a positive integer.' : undefined) }).int('sizeBytes must be a positive integer.').positive('sizeBytes must be a positive integer.').max(MAX_VIDEO_UPLOAD_BYTES, 'Video is too large. Maximum is 2GB.'),
}).refine((body) => !isImageUploadContentType(body.contentType) || body.sizeBytes <= MAX_IMAGE_UPLOAD_BYTES, {
  message: 'Image is too large. Maximum is 8 MB.',
  path: ['sizeBytes'],
});

export const MintVideoUploadResponseSchema = z.object({
  success: z.literal(true),
  uploadId: z.string(),
  signedUrl: z.string(),
  token: z.string(),
  storagePath: z.string(),
  expiresAt: z.string(),
  maxBytes: z.number(),
});

export const CompleteVideoUploadResponseSchema = z.object({ success: z.literal(true), uploadId: z.string(), status: z.literal('ready'), contentType: z.enum(UPLOAD_CONTENT_TYPES), sizeBytes: z.number() });

function optionalContractString(field: string) {
  return z.string({ error: () => `${field} must be a string.` }).optional();
}

export const PublishByIdBodySchema = z.object({
  uploadId: z
    .string({
      error: () => 'uploadId must be the id returned by the signed-upload mint step.',
    })
    .refine((value) => UUID.test(value), {
      message: 'uploadId must be the id returned by the signed-upload mint step.',
    }),
  provider: z.enum(SOCIAL_PROVIDERS, {
    error: () => 'provider is invalid.',
  }),
  accountIds: z
    .array(
      z.string({
        error: () => 'At least one account ID is required.',
      }),
    )
    .min(1, 'At least one account ID is required.')
    .refine((ids) => ids.every((id) => id.trim() !== ''), {
      message: 'At least one account ID is required.',
    }),
  tags: z
    .array(
      z.string({
        error: () => 'tags must be a list of strings.',
      }),
      {
        error: () => 'tags must be a list of strings.',
      },
    )
    .optional(),
  title: optionalContractString('title'),
  description: optionalContractString('description'),
  privacyStatus: optionalContractString('privacyStatus'),
  caption: optionalContractString('caption'),
  boardId: optionalContractString('boardId'),
});

export const generateAndSchedule = defineEndpoint({
  method: 'POST',
  path: '/api/videos/generate-and-schedule',
  body: GenerateAndScheduleBodySchema,
  response: GenerateAndScheduleResponseSchema,
});

export const validateScript = defineEndpoint({
  method: 'POST',
  path: '/api/videos/validate-script',
  body: ValidateScriptBodySchema,
  response: ValidateScriptResponseSchema,
});

export const scoreDraft = defineEndpoint({
  method: 'POST',
  path: '/api/videos/score-draft',
  body: ScoreDraftBodySchema,
  response: ScoreDraftResponseSchema,
});

export const applyBatchDiscount = defineEndpoint({
  method: 'POST',
  path: '/api/videos/batch-discount',
  body: BatchDiscountBodySchema,
  response: BatchDiscountResponseSchema,
});

export const mintVideoUpload = defineEndpoint({
  method: 'POST',
  path: '/api/videos/upload-url',
  body: MintVideoUploadBodySchema,
  response: MintVideoUploadResponseSchema,
});

export const completeVideoUpload = defineEndpoint({
  method: 'POST',
  path: '/api/videos/uploads/:uploadId/complete',
  response: CompleteVideoUploadResponseSchema,
});

export const publishUploadedVideo = defineEndpoint({
  method: 'POST',
  path: '/api/videos/publish-by-id',
  body: PublishByIdBodySchema,
  response: UploadContentResponseSchema,
});
