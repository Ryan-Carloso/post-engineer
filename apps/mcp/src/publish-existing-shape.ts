import { z } from 'zod';
import { MAX_PUBLISH_IMAGE_MB } from './limits.js';
import { PublishVideoDirectShape } from './publish-direct-shape.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PublishExistingShape = {
  mediaKind: z
    .enum(['upload', 'image'])
    .describe('upload = a completed signed upload, video or image (uploadId); image = a local JPEG/PNG (imagePath).'),
  uploadId: z
    .string()
    .regex(UUID_PATTERN, 'uploadId must be a UUID')
    .optional()
    .describe('mediaKind upload: the uploadId from create_upload + complete_upload. Single-use: publish it to every network in this one call.'),
  imagePath: z
    .string()
    .min(1, 'imagePath is required')
    .optional()
    .describe(`mediaKind image: local path of the JPEG or PNG (max ${MAX_PUBLISH_IMAGE_MB} MB).`),
  accounts: z
    .array(z.string().min(1))
    .min(1, 'Provide at least one account')
    .optional()
    .describe("Accounts to publish to, each an account name or id from accounts (action: list); the network is read from the account, so one call can reach several networks. Omit to use the persona's bound publishing accounts."),
  title: z
    .string()
    .min(1, 'title is required')
    .max(100, 'title must be at most 100 characters')
    .describe('The title (YouTube, Rumble, Fanvue, Pinterest show it; required for every post).'),
  description: z
    .string()
    .min(1, 'description is required')
    .max(5000, 'description must be at most 5000 characters')
    .describe('The post text: the video description, and the caption on Instagram, Bluesky, LinkedIn, Threads, Facebook and 3Speak.'),
  caption: z
    .string()
    .min(1)
    .optional()
    .describe('Optional: a different text for the caption networks. Omit to use description.'),
  personaId: z
    .string()
    .optional()
    .describe('The persona id. Omit to publish without a persona.'),
  mode: z
    .enum(['asap', 'scheduled'])
    .describe("Required. 'asap' publishes now; 'scheduled' publishes once at publishAt."),
  publishAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'publishAt must be an ISO datetime (e.g. "2026-12-01T20:00:00")',
    })
    .optional()
    .describe("mode scheduled: when to publish, 3h-30d ahead. Wall-clock in timezone (e.g. \"2026-12-01T20:00:00\"), or with an offset."),
  timezone: z.string().min(1).default('UTC').describe('IANA timezone for a publishAt without an offset. Defaults to UTC.'),
  tags: PublishVideoDirectShape.tags.describe('YouTube only: required with mode asap (scheduled derives them from the title).'),
  privacyStatus: PublishVideoDirectShape.privacyStatus.describe('YouTube only: required with mode asap.'),
  boardId: PublishVideoDirectShape.boardId,
  firstComment: PublishVideoDirectShape.firstComment,
  promptVersionId: z
    .string()
    .regex(UUID_PATTERN, 'promptVersionId must be a UUID')
    .optional()
    .describe('mode scheduled only: the versionId of the prompt the post was written from (prompts (action: get)), so experiments (action: results) can compare prompts.'),
  idempotencyKey: z
    .string()
    .min(1)
    .optional()
    .describe('Retry a timed-out call with the SAME key: the server returns the original result (the schedule, or the posts already published per account) instead of publishing again. Omitted: a key is generated per call.'),
};

const { imagePath: _imagePath, mediaKind: _mediaKind, ...remoteFields } = PublishExistingShape;

export const PublishExistingRemoteShape = {
  mediaKind: PublishExistingShape.mediaKind.describe(
    'upload = a completed signed upload, video or image (uploadId); image is not offered on a remote server — send the image through create_upload → PUT → complete_upload and publish it as mediaKind upload.',
  ),
  ...remoteFields,
};

export const PublishExistingSchema = z.object(PublishExistingShape).strict().superRefine((value, ctx) => {
  if (value.mediaKind === 'upload' && value.uploadId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uploadId'], message: 'uploadId is required when mediaKind is upload.' });
  }
  if (value.mediaKind === 'image' && value.imagePath === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['imagePath'],
      message: 'mediaKind image needs imagePath (a local JPEG or PNG). On a remote server, upload the image with create_upload → PUT → complete_upload and publish it as mediaKind upload.',
    });
  }
  if (value.mode === 'scheduled' && value.publishAt === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['publishAt'], message: 'publishAt is required when mode is scheduled.' });
  }
  if (value.mode === 'asap' && value.publishAt !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['publishAt'], message: "publishAt must not be set when mode is asap: asap publishes now. Use mode 'scheduled' to publish later." });
  }
});

export type PublishExistingArgs = z.infer<typeof PublishExistingSchema>;
