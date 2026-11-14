// Shape for publish_video (action: publish_existing) (issue #384):
// publish or schedule media that already exists — a finished engine
// video by task id, a ready signed-upload video by upload id, or a plain
// image as inline base64 bytes — with no generation and no token charge.
// Single provider + accountIds per call, mirroring publish_upload; the
// client builds the web route's providers/accounts publishing shape.
// Kept in a new module so intent-content.ts stays under the file-size
// ratchet.
import { z } from 'zod';
import { PublishVideoDirectShape } from './publish-direct-shape.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PublishExistingShape = {
  mediaKind: z
    .enum(['task', 'upload', 'image'])
    .describe('task = finished video by taskId; upload = ready upload by uploadId; image = inline base64 bytes (instagram only).'),
  taskId: z
    .string()
    .min(1, 'taskId is required')
    .optional()
    .describe('mediaKind task: the engine task id of the finished video.'),
  uploadId: z
    .string()
    .regex(UUID_PATTERN, 'uploadId must be a UUID')
    .optional()
    .describe('mediaKind upload: the uploadId of a completed signed upload (create_upload + complete_upload). Single-use.'),
  imageData: z
    .string()
    .min(1, 'imageData is required')
    .optional()
    .describe('mediaKind image: the image bytes as base64 (JPEG or PNG, max 8 MB).'),
  imageContentType: z
    .enum(['image/jpeg', 'image/png'])
    .optional()
    .describe('mediaKind image: the real image type.'),
  provider: PublishVideoDirectShape.provider,
  accountIds: PublishVideoDirectShape.accountIds,
  title: z
    .string()
    .min(1, 'title is required')
    .max(100, 'title must be at most 100 characters')
    .describe('The title (required).'),
  description: z
    .string()
    .min(1, 'description is required')
    .max(5000, 'description must be at most 5000 characters')
    .describe('The publish copy (required).'),
  personaId: z
    .string()
    .optional()
    .describe('The persona id. Omit for a faceless post.'),
  mode: z
    .enum(['scheduled', 'asap'])
    .default('scheduled')
    .describe("'scheduled' (default) slots the post at startAt + times; 'asap' publishes right away — do not set startAt or times."),
  startAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'startAt must be a valid ISO datetime (e.g. "2026-10-02T20:00:00")',
    })
    .optional()
    .describe('ISO datetime for the slot start. Required unless mode is \'asap\' (3h-30d ahead).'),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Each time must be HH:MM in 24-hour format (e.g. "09:30", "20:00")'))
    .min(1, 'Provide at least one publish time')
    .optional()
    .describe('Daily publish times (HH:MM). Required unless mode is \'asap\'.'),
  timezone: z.string().min(1).default('UTC').describe('IANA timezone for startAt and times. Defaults to UTC.'),
  tags: PublishVideoDirectShape.tags,
  privacyStatus: PublishVideoDirectShape.privacyStatus,
  caption: PublishVideoDirectShape.caption,
  boardId: PublishVideoDirectShape.boardId,
  idempotencyKey: PublishVideoDirectShape.idempotencyKey,
};

export const PublishExistingSchema = z.object(PublishExistingShape).strict().superRefine((value, ctx) => {
  // One media reference per kind: the server 400s a missing one, so fail
  // here, locally, before any fetch.
  if (value.mediaKind === 'task' && value.taskId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taskId'], message: 'taskId is required when mediaKind is task.' });
  }
  if (value.mediaKind === 'upload' && value.uploadId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uploadId'], message: 'uploadId is required when mediaKind is upload.' });
  }
  if (value.mediaKind === 'image') {
    if (value.imageData === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['imageData'], message: 'imageData is required when mediaKind is image.' });
    }
    if (value.imageContentType === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['imageContentType'], message: 'imageContentType is required when mediaKind is image.' });
    }
    // Images post only where a handler accepts them: Instagram today.
    if (value.provider !== 'instagram') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'Images can only be published to instagram for now: its handler is the only one that accepts image files.' });
    }
  }
  if (value.mode === 'scheduled' && (value.startAt === undefined || value.times === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'startAt and times are required when mode is scheduled.' });
  }
  if (value.mode === 'asap' && (value.startAt !== undefined || value.times !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'startAt and times must not be set when mode is asap.' });
  }
});
