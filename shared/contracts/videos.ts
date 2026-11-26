import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { UploadContentResponseSchema } from './media.js';
import { UUID } from './metrics.js';
import { SOCIAL_PROVIDERS } from './providers.js';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, UPLOAD_CONTENT_TYPE_MESSAGE, isImageUploadContentType } from './upload-types.js';

export const MAX_REPORTED_ISSUES = 20;

export const PUBLISH_NETWORKS = SOCIAL_PROVIDERS;
export type PublishNetwork = (typeof PUBLISH_NETWORKS)[number];

export * from './upload-types.js';

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
