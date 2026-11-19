import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

export const MEDIA_ID_PATTERN = /^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$/;

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

export const MediaCheckBodySchema = z.object({
  url: z
    .string()
    .min(1, 'url is required.')
    .refine((value) => isHttpUrl(value), { message: 'url must be an http(s) URL.' }),
  videoAspect: z.enum(VIDEO_ASPECTS).optional(),
});
export type MediaCheckBody = z.infer<typeof MediaCheckBodySchema>;

export const MediaCheckResponseSchema = z.object({
  success: z.literal(true),
  code: z.enum(CHECK_MEDIA_CODES),
  width: z.number().optional(),
  height: z.number().optional(),
  has_face: z.unknown().optional(),
});
export type MediaCheckResponse = z.infer<typeof MediaCheckResponseSchema>;

export const UploadMediaResponseSchema = z.object({
  success: z.literal(true),
  mediaId: z.string().regex(MEDIA_ID_PATTERN),
  expiresInSeconds: z.number(),
});
export type UploadMediaResponse = z.infer<typeof UploadMediaResponseSchema>;

export const DirectPublishAccountResultSchema = z.object({
  accountId: z.string(),
  success: z.boolean(),
  videoId: z.string().optional(),
  videoUrl: z.string().optional(),
  postId: z.string().optional(),
  permalink: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
});
export type DirectPublishAccountResult = z.infer<typeof DirectPublishAccountResultSchema>;

export const UploadContentResponseSchema = z.object({
  success: z.boolean(),
  provider: z.string().optional(),
  results: z.array(DirectPublishAccountResultSchema),
  successCount: z.number().optional(),
  logId: z.string().optional(),
  error: z.string().optional(),
});
export type UploadContentResponse = z.infer<typeof UploadContentResponseSchema>;

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
