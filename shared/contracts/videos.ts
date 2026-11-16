// Video generation and publish-by-id contract: the single source of truth
// for POST /api/videos/generate-and-schedule, validate-script, score-draft,
// batch-discount, upload-url, uploads/:uploadId/complete and publish-by-id.
// Both apps generate a copy of this file (see scripts/sync-contracts.mjs);
// never edit a generated copy by hand.
//
// The web routes keep their own parsers where the 400 carries more than the
// shape (generate-and-schedule collects every issue, validate-script and
// score-draft report semantic failures with stable codes, mint/publish-by-id
// answer with coded errors): the contract mirrors the shape those parsers
// accept, and the equivalence tests pin the two together. Response schemas
// are plain objects (extra fields ignored).
//
// Duplicated literals, each pinned by a file-parsing sync test because the
// owning module cannot import this contract: VIDEO_TYPES /
// VIDEO_TYPE_ERROR_SUFFIX / unknownVideoTypeMessage mirror lib/tokens.ts,
// apps/mcp/src/video-type.ts and the engine's VIDEO_TYPE_ERROR_SUFFIX;
// MAX_SEGMENTS / MAX_IMAGES_MODE_MEDIAS / HOOK_MIN_SECONDS / HOOK_MAX_SECONDS
// mirror shared/script-segments/script-segments.ts, the source of the
// generated copies in both apps (a relative import from a synced contract
// cannot reach it: the two apps keep it at different depths).
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { EXPERIMENT_TARGET_PAIRS_MAX, EXPERIMENT_VARIANT_ID_PATTERN } from './experiments.js';
import { UploadContentResponseSchema } from './media.js';
import { UUID } from './metrics.js';
import { SOCIAL_PROVIDERS } from './providers.js';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, UPLOAD_CONTENT_TYPE_MESSAGE, isImageUploadContentType } from './upload-types.js';

/** The one video mode (issue #542): it decides render path + price. */
export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

/**
 * The invalid-video_type message suffix: every valid type WITH its token
 * cost, so the agent can choose knowing the price. Must stay identical to
 * the engine's VIDEO_TYPE_ERROR_SUFFIX (apps/engine/app/models/schema.py)
 * and to lib/tokens.ts / apps/mcp/src/video-type.ts.
 */
export const VIDEO_TYPE_ERROR_SUFFIX =
  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';

/** Short invalid-video_type error, costs included, under 200 chars. */
export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}

/** Missing-video_type error: same suffix, so the agent sees values + costs. */
export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

/** Segments per video: the shape cap, before the content rules run. */
export const MAX_SEGMENTS = 12;
/** Photos per segment in images mode (full lip sync allows at most 6 in total). */
export const MAX_IMAGES_MODE_MEDIAS = 30;
/** Spoken hook window, seconds: reported by validate-script. */
export const HOOK_MIN_SECONDS = 8;
export const HOOK_MAX_SECONDS = 12;

/**
 * How many problems a pre-auth 400 will echo. The route runs before session
 * and rate-limit checks, and a caller can send a huge array, so at most this
 * many problems are echoed. Each field path and each message is also
 * length-capped where the response is built. The event's errorCount is the
 * real total.
 */
export const MAX_REPORTED_ISSUES = 20;

/** Videos per batch (issue #487): the cheapest face video of every 6 is free. */
export const MAX_BATCH_VIDEOS = 12;
/** Batch key: letters, digits, "-" and "_" only, at most 100 chars. */
export const BATCH_KEY_MAX_LENGTH = 100;
export const BATCH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** What the scored text is: a post body, or a video script. */
export const DRAFT_KINDS = ['post', 'script'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** The networks score-draft can publish-check: every network. */
export const PUBLISH_NETWORKS = SOCIAL_PROVIDERS;
export type PublishNetwork = (typeof PUBLISH_NETWORKS)[number];

/** Drafts over this input cap are a 400, never silently truncated. */
export const DRAFT_MAX_INPUT_CHARS = 10000;

// Signed-upload media types and ceilings: upload-types.ts (import-free, read by the OpenAPI generator).
export * from './upload-types.js';

//---------------
// Segments script (moved verbatim from
// app/api/videos/generate-and-schedule/segments-schema.ts): strict at
// every level so an unknown key is a 400, never silently dropped.
// Content rules (word counts) live in the shared validator; this pins
// the shape plus the segment-count cap.
//---------------
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
      media: z
        .array(
          z
            .object({
              mediaId: z.string().optional(),
              url: z.string().optional(),
              overlay: segmentOverlaySchema.optional(),
            })
            .strict(),
        )
        .max(MAX_IMAGES_MODE_MEDIAS)
        .optional(),
    })
    .strict(),
).max(MAX_SEGMENTS);

/** Paired A/B experiment link (issue #476): one variant of one pair. */
export const ExperimentLinkSchema = z
  .object({
    experimentId: z.string().uuid(),
    variantId: z.string().regex(EXPERIMENT_VARIANT_ID_PATTERN),
    pair: z.number().int().min(1).max(EXPERIMENT_TARGET_PAIRS_MAX),
  })
  .strict();

export type ExperimentLink = z.infer<typeof ExperimentLinkSchema>;

//---------------
// POST /api/videos/generate-and-schedule — moved verbatim from the route
// (BodySchema). Plain object, not strict: the route rejects unknown keys
// itself (rawKeyIssues — a `topics` key is a 400 naming the field, never
// stripped silently), and the semantic checks (mode/schedule coupling,
// segments required per mode, providers vs persona) run after the shape
// parse in request-validation.ts, never here.
//---------------
const PublishingScheduleSchema = z.object({
  startAt: z.string(),
  times: z.array(z.string()),
  timezone: z.string(),
});

const PublishingSchema = z.object({
  // 'scheduled' (default): publish at the slot times. 'asap': publish each
  // video the moment generation finishes, with no scheduled time.
  mode: z.enum(['scheduled', 'asap']).optional(),
  providers: z.array(z.string()).max(MAX_REPORTED_ISSUES),
  accounts: z.record(z.string(), z.array(z.string())).optional(),
  pinterestBoardId: z.string().max(100).optional(),
  // Required in scheduled mode, forbidden in asap mode (a stray plan would
  // be silently ignored, so it is a 400 instead).
  schedule: PublishingScheduleSchema.optional(),
  // ASAP-only: the user's IANA zone, kept for display. Optional because the
  // schedules.timezone column is NOT NULL DEFAULT 'UTC'.
  timezone: z.string().optional(),
});

const OptionsSchema = z
  .object({
    // The one video mode (issue #542 follow-up), required: it decides
    // render path + price. Zod v4 dropped errorMap, so the message lives
    // in `error` (missing -> required, else unknown-mode with costs).
    videoType: z.enum(VIDEO_TYPES, {
      error: (issue) => (issue.input === undefined ? `options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}` : unknownVideoTypeMessage(issue.input)),
    }),
    // Inlined from shared/music-mood-field/music-mood-field.ts: the
    // contract cannot import it (the two apps keep the generated copy at
    // different depths). The equivalence test pins the bounds + describe
    // text to the shared field.
    musicMood: z.string().min(1).max(64).optional().describe('Background-music mood for the video: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood; an unknown mood is rejected with a 400 naming the valid moods. Works with faceless videos too.'),
    audioUrl: z.string().optional(),
    imageId: z.string().optional(),
    // Segments contract (MCP first, Phase 1): one call = one video; the
    // joined script becomes the video script, no LLM expands it. The engine's persona script budget and duration trim still apply downstream.
    segments: segmentsRequestSchema.optional(),
    webhookUrl: z.string().optional(),
    voiceId: z.string().optional(),
    // The rest of a persona's editorial definition, for a post created
    // WITHOUT one (migration 012). With a persona these still override it.
    videoAspect: z.enum(['9:16', '16:9', '1:1']).optional(),
    videoLayout: z.enum(['standard', 'react']).optional(),
    paragraphNumber: z.number().int().min(1).max(10).optional(),
    language: z.string().optional(),
    niche: z.string().optional(),
  })
  .optional();

export const GenerateAndScheduleBodySchema = z.object({
  // Optional: a post without a persona is faceless (options.videoType
  // 'faceless') and defined entirely by options + title + description.
  personaId: z.string().optional(),
  // The slot label. At most 100 chars (YouTube's cap): the engine rejects
  // longer titles at dispatch, so fail here, pre-charge.
  title: z.string().max(100, 'title must be at most 100 characters.'),
  // Agent-supplied video description (issue #542 follow-up), REQUIRED: the publish copy. Zod v4 dropped required_error, so the missing-value message lives in `error`.
  description: z.string({ error: (issue) => (issue.input === undefined ? 'description is required: the publish copy for this video.' : undefined) }).min(1, 'description must be a non-empty string: the publish copy for this video.').max(5000, 'description must be at most 5000 characters.'),
  publishing: PublishingSchema,
  options: OptionsSchema,
  idempotencyKey: z.string().optional(),
  // Paired A/B experiment link (issue #476), checked before the charge.
  experiment: ExperimentLinkSchema.optional(),
});

export type GenerateAndScheduleBody = z.infer<typeof GenerateAndScheduleBodySchema>;

export const GenerateSlotResultSchema = z.object({
  slotId: z.string(),
  slotAt: z.string(),
  title: z.string(),
  taskId: z.string().nullable(),
  status: z.string(),
  /** Machine code for a failed slot (image_sign_failed, engine_rejected, ...). */
  errorCode: z.string().optional(),
  /** Whether the prepaid cost was returned after a failed dispatch. */
  tokensRefunded: z.boolean().optional(),
});

// Voice-fallback warning object (never a bare string): the persona's stored
// voice was missing or unroutable, so the route dispatched with the house
// default. Only one code exists today (`voice_fallback_applied`).
export const GenerateAndScheduleWarningSchema = z.object({ code: z.string(), fromVoice: z.string(), toVoice: z.string() });

// The all-failed 502 envelope ({ success: false, error, code, ... }) is
// not modelled: the MCP throws on non-2xx before parsing, so only the
// success shape reaches the client.
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

//---------------
// POST /api/videos/validate-script — mechanical segments-script
// validation only. The route runs validateSegments after the shape parse;
// the body schema mirrors the fields it reads (segments is opaque here,
// the validator owns its content rules).
//---------------
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

//---------------
// POST /api/videos/score-draft — mechanical draft scoring. The route
// keeps its hand-rolled parseBody (the non-object body message and the
// per-field messages are part of its 400 contract); this schema mirrors
// its rules, message for message.
//---------------
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
  // True when the capped read left rows out, so the numbers above describe
  // only the most recent BASELINE_ROW_LIMIT snapshots.
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
  // Null for a script: caption limits do not apply to spoken text.
  publishCheck: PublishCheckSchema.nullable(),
});

//---------------
// POST /api/videos/batch-discount — the "6 for 5" batch discount
// (issue #487). The route keeps its local parse (first-issue message,
// bare) plus the duplicate-scheduleIds check that runs after it.
//---------------
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

//---------------
// POST /api/videos/upload-url + POST /api/videos/uploads/:uploadId/complete
// — signed video uploads (issue #561). The mint route keeps its coded
// parseMintBody (VIDEO_UPLOAD_INVALID_* + the 413 for an oversize
// declaration); this schema mirrors its accept/reject boundary.
//---------------
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

//---------------
// POST /api/videos/publish-by-id — publish a signed-upload video by id
// (issue #561). The route keeps its coded parsePublishBody (ValidationError
// + field); this schema mirrors its shape rules. The provider-specific
// required fields (title/description for youtube/rumble/fanvue, tags +
// privacyStatus for youtube, boardId + description/caption for pinterest)
// are semantic checks in validatePublishFields, not shape rules.
// The response is the media contract's upload-content shape: the route
// returns the normalized publish result plus the computed successCount.
//---------------
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

//---------------
// Endpoints.
//---------------
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
