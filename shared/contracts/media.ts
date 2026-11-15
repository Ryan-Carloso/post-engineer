//---------------
// media — the segment-media and direct-publish contract, shared by the
// web routes and the MCP media / direct-publish calls.
//
// POST /api/media/upload is multipart (FormData with a `file`): the
// contract owns only its response. POST /api/media/check takes JSON;
// its route validation stays hand-rolled (the 400 messages are part of
// the route's behaviour — see below) and the contract body schema
// mirrors it, pinned by the MCP tool-schema equivalence test.
// POST /api/upload-content is multipart FormData dispatched per
// provider; its response is the direct-publish result shared with
// POST /api/videos/publish-by-id (which reuses the same response
// schema from here).
//---------------

import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

/** The engine-minted temp-asset filename: 32 hex chars + an image
 * extension. Mirrors apps/web/app/api/media/upload/route.ts
 * (MEDIA_ID_PATTERN): the full URL is never returned, only this id. */
export const MEDIA_ID_PATTERN = /^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$/;

/** Mechanical check outcomes from the engine. Mirrors
 * apps/web/app/api/media/check/route.ts (CHECK_CODES). */
export const CHECK_MEDIA_CODES = [
  'ok',
  'blocked_403',
  'not_image',
  'too_small',
  'too_large',
  'timeout',
  'wrong_aspect',
  'media_expired',
] as const;
export type CheckMediaCode = (typeof CHECK_MEDIA_CODES)[number];

/** Video aspects a photo can be checked against. Mirrors
 * apps/web/app/api/media/check/route.ts (VIDEO_ASPECTS) and the engine
 * VideoAspect enum. */
export const VIDEO_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

//---------------
// POST /api/media/check body — mirrors the route's hand-rolled
// validation exactly: url is required (empty counts as missing), must
// be an http(s) URL, and videoAspect is one of the three aspects when
// given. The route ignores unknown fields, so the schema is a plain
// object, not strict.
//---------------
export const MediaCheckBodySchema = z.object({
  url: z
    .string()
    .min(1, 'url is required.')
    .refine((value) => isHttpUrl(value), { message: 'url must be an http(s) URL.' }),
  videoAspect: z.enum(VIDEO_ASPECTS).optional(),
});
export type MediaCheckBody = z.infer<typeof MediaCheckBodySchema>;

//---------------
// Response views.
//---------------
export const MediaCheckResponseSchema = z.object({
  success: z.literal(true),
  code: z.enum(CHECK_MEDIA_CODES),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type MediaCheckResponse = z.infer<typeof MediaCheckResponseSchema>;

export const UploadMediaResponseSchema = z.object({
  success: z.literal(true),
  mediaId: z.string().regex(MEDIA_ID_PATTERN),
  expiresInSeconds: z.number(),
});
export type UploadMediaResponse = z.infer<typeof UploadMediaResponseSchema>;

// One per-account outcome of a direct publish — mirrors
// apps/web/lib/upload/content-upload-result.ts
// (ContentUploadAccountResult). The MCP drops uploadDuration/mediaId;
// the schema lists the fields the agent acts on (errorCode especially:
// publish_unknown means the post may already be live — do not retry).
export const DirectPublishAccountResultSchema = z.object({
  accountId: z.string(),
  success: z.boolean(),
  videoId: z.string().optional(),
  videoUrl: z.string().optional(),
  postId: z.string().optional(),
  // Ready-made post URL (Pinterest pin URL, Instagram/Threads/Facebook permalink).
  permalink: z.string().optional(),
  error: z.string().optional(),
  // Stable per-account failure code from classifyUploadAccountError.
  errorCode: z.string().optional(),
});
export type DirectPublishAccountResult = z.infer<typeof DirectPublishAccountResultSchema>;

// The 200 body of POST /api/upload-content (and of
// POST /api/videos/publish-by-id, which dispatches to the same provider
// handlers). success is a plain boolean: a multi-account publish can
// succeed on some accounts and fail on others. provider/logId/error
// flow through from the handler responses when the handler sets them.
export const UploadContentResponseSchema = z.object({
  success: z.boolean(),
  provider: z.string().optional(),
  results: z.array(DirectPublishAccountResultSchema),
  successCount: z.number().optional(),
  logId: z.string().optional(),
  error: z.string().optional(),
});
export type UploadContentResponse = z.infer<typeof UploadContentResponseSchema>;

//---------------
// Endpoints. upload and upload-content are multipart FormData, so they
// declare no JSON body schema.
//---------------
export const uploadMedia = defineEndpoint({
  method: 'POST',
  path: '/api/media/upload',
  response: UploadMediaResponseSchema,
});

export const checkMedia = defineEndpoint({
  method: 'POST',
  path: '/api/media/check',
  body: MediaCheckBodySchema,
  response: MediaCheckResponseSchema,
});

export const uploadContent = defineEndpoint({
  method: 'POST',
  path: '/api/upload-content',
  response: UploadContentResponseSchema,
});
