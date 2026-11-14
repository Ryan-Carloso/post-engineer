//---------------
// Publish-existing request schema (issue #384): publish or schedule media
// that already exists — a finished engine video (task id), a ready signed
// video upload (upload id), or a plain image (inline bytes). No generation
// runs on this path, so there is no script, no video type, and no token
// charge; title + description stay required (issue #542), and the
// publishing shape mirrors generate-and-schedule (ASAP or scheduled).
//---------------

import { z } from 'zod';

import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import { resolveTitle } from '@/app/api/videos/generate-and-schedule/request-title';
import {
  validatePinterestBoard,
  validateProviders,
  type Provider,
} from '@/app/api/videos/generate-and-schedule/providers-validation';
import {
  invalid,
  type Checked,
  type ValidationIssue,
} from '@/app/api/videos/generate-and-schedule/validation-issues';

/** Inline image bytes ride in the JSON body, like the MCP media tool. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/** A task id is engine-minted; the engine 404s an unknown one, so the
 *  schema only requires a non-empty string instead of a UUID shape. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MediaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), taskId: z.string().min(1, 'taskId is required.') }).strict(),
  z.object({ kind: z.literal('upload'), uploadId: z.string().regex(UUID_PATTERN, 'uploadId must be a UUID.') }).strict(),
  z
    .object({
      kind: z.literal('image'),
      imageData: z.string().min(1, 'imageData is required.'),
      contentType: z.enum(IMAGE_CONTENT_TYPES),
    })
    .strict(),
]);

const PublishingScheduleSchema = z
  .object({
    startAt: z.string(),
    times: z.array(z.string()).min(1).max(10),
    timezone: z.string(),
  })
  .strict();

const PublishingSchema = z
  .object({
    mode: z.enum(['scheduled', 'asap']).optional(),
    providers: z.array(z.string()).min(1).max(10),
    accounts: z.record(z.string(), z.array(z.string())).optional(),
    schedule: PublishingScheduleSchema.optional(),
    pinterestBoardId: z.string().max(100).optional(),
  })
  .strict();

const BodySchema = z
  .object({
    media: MediaSchema,
    title: z.string().max(100, 'title must be at most 100 characters.'),
    description: z.string().max(5000, 'description must be at most 5000 characters.'),
    personaId: z.string().optional(),
    publishing: PublishingSchema,
    tags: z.array(z.string()).optional(),
    privacyStatus: z.string().optional(),
    caption: z.string().optional(),
    idempotencyKey: z.string().optional(),
  })
  .strict();

export type PublishExistingMediaInput = z.infer<typeof MediaSchema>;

export interface PublishExistingRequest {
  media: PublishExistingMediaInput;
  title: string;
  description: string;
  personaId: string | null;
  publishing: {
    mode: 'asap' | 'scheduled';
    providers: Provider[];
    accounts: Record<string, string[] | undefined> | undefined;
    schedule: { startAt: string; times: string[]; timezone: string } | undefined;
    pinterestBoardId: string | null;
  };
  /** YouTube tags / privacy, required for ASAP (the handlers demand them);
   *  scheduled YouTube derives tags from the title like the engine does. */
  tags: string[] | undefined;
  privacyStatus: string | undefined;
  /** Publish copy override; defaults to the description at dispatch. */
  caption: string | undefined;
  idempotencyKey: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => invalid(issue.message, issue.path.join('.') || undefined));
}

/**
 * Shape check only: unknown keys, wrong types, over-long title/description.
 * Cross-field rules (providers, mode/schedule, image providers, YouTube
 * fields) live in checkPublishExistingSemantics, which runs on the parsed
 * value like generate-and-schedule's checkSemantics.
 */
export function parsePublishExistingBody(body: unknown): Checked<z.infer<typeof BodySchema>> {
  if (!isRecord(body)) {
    return { ok: false, issues: [invalid('A JSON body is required.', undefined)] };
  }
  // The discriminated union reports a bad kind at the union path; name the
  // field the caller actually got wrong instead of the whole media object.
  if (isRecord(body.media) && typeof body.media.kind === 'string') {
    const kind = body.media.kind;
    if (kind !== 'task' && kind !== 'upload' && kind !== 'image') {
      return {
        ok: false,
        issues: [invalid('media.kind must be one of: task, upload, image.', 'media.kind')],
      };
    }
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, issues: toIssues(parsed.error) };
  return { ok: true, value: parsed.data };
}

function resolveDescription(description: string): Checked<string> {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      issues: [invalid('description must be a non-empty string: the publish copy for this video.', 'description')],
    };
  }
  return { ok: true, value: trimmed };
}

export function checkPublishExistingSemantics(
  input: z.infer<typeof BodySchema>,
): Checked<PublishExistingRequest> {
  const issues: ValidationIssue[] = [];
  const title = resolveTitle(input.title);
  if (!title.ok) issues.push(...title.issues);
  const description = resolveDescription(input.description);
  if (!description.ok) issues.push(...description.issues);

  const providers = validateProviders(input.publishing.providers);
  if (!providers.ok) issues.push(...providers.issues);
  const board = validatePinterestBoard(input.publishing.providers, input.publishing.pinterestBoardId);
  if (!board.ok) issues.push(...board.issues);

  const mode = input.publishing.mode ?? 'scheduled';
  if (mode === 'asap' && input.publishing.schedule !== undefined) {
    issues.push(invalid("publishing.schedule must not be set when publishing.mode is 'asap'.", 'publishing.schedule'));
  }
  if (mode === 'scheduled' && input.publishing.schedule === undefined) {
    issues.push(invalid("publishing.schedule is required when publishing.mode is 'scheduled'.", 'publishing.schedule'));
  }

  // Images post only where a handler accepts them: Instagram today (its
  // handler already takes JPEG/PNG). The other providers are video-only
  // until their handlers grow an image branch (issue #384 follow-up).
  if (input.media.kind === 'image' && providers.ok) {
    const onlyInstagram = providers.value.length === 1 && providers.value[0] === 'instagram';
    if (!onlyInstagram) {
      issues.push(
        invalid('Images can only be published to instagram for now: its handler is the only one that accepts image files.', 'publishing.providers'),
      );
    }
  }

  // ASAP dispatches straight to the provider handlers, which require
  // YouTube tags + privacy; scheduled YouTube derives both from the title
  // in the engine (metadata_for), so they stay optional there.
  if (mode === 'asap' && providers.ok && providers.value.includes('youtube')) {
    if (input.tags === undefined || input.tags.length === 0) {
      issues.push(invalid('Video tags are required', 'tags'));
    }
    if (input.privacyStatus === undefined || !['public', 'private', 'unlisted'].includes(input.privacyStatus)) {
      issues.push(invalid('Invalid privacy status. Use "public", "private" or "unlisted"', 'privacyStatus'));
    }
  }

  if (issues.length > 0 || !title.ok || !description.ok || !providers.ok || !board.ok) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      media: input.media,
      title: title.value,
      description: description.value,
      personaId: input.personaId?.trim() ? input.personaId.trim() : null,
      publishing: {
        mode,
        providers: providers.value,
        accounts: input.publishing.accounts,
        schedule: input.publishing.schedule,
        pinterestBoardId: board.value,
      },
      tags: input.tags,
      privacyStatus: input.privacyStatus,
      caption: input.caption,
      idempotencyKey: input.idempotencyKey,
    },
  };
}

/**
 * Decode inline image bytes: strict base64, 8 MB cap, and magic bytes that
 * match the declared type — the same real-content rule the upload handlers
 * apply, before the bytes ever reach a provider. Base64 strictness is a
 * length + round-trip check, never a regex: the alphabet pattern
 * backtracks catastrophically on multi-megabyte input.
 */
export function decodeImageMedia(media: {
  imageData: string;
  contentType: ImageContentType;
}): Checked<{ buffer: Buffer; contentType: ImageContentType }> {
  const { imageData, contentType } = media;
  const compact = imageData.replace(/\s/g, '');
  const buffer = compact.length > 0 && compact.length % 4 === 0 ? Buffer.from(compact, 'base64') : Buffer.alloc(0);
  if (compact.length === 0 || buffer.toString('base64') !== compact) {
    return { ok: false, issues: [invalid('media.imageData must be base64-encoded bytes.', 'media.imageData')] };
  }
  if (buffer.length === 0) {
    return { ok: false, issues: [invalid('media.imageData is empty.', 'media.imageData')] };
  }
  if (buffer.length > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      issues: [invalid('Image is too large. Maximum is 8 MB.', 'media.imageData')],
    };
  }
  const detected = detectMagicMimeType(buffer);
  if (detected !== contentType) {
    return {
      ok: false,
      issues: [invalid('The image content does not match the declared content type.', 'media.imageData')],
    };
  }
  return { ok: true, value: { buffer, contentType } };
}
