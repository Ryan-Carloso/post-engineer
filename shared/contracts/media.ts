import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';
import { FIRST_COMMENT_WARNING_CODES } from './first-comment.js';

export const DirectPublishAccountResultSchema = z.object({
  accountId: z.string(),
  success: z.boolean(),
  videoId: z.string().optional(),
  videoUrl: z.string().optional(),
  postId: z.string().optional(),
  permalink: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  warnings: z.array(z.enum(FIRST_COMMENT_WARNING_CODES)).optional(),
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

export const uploadContent = defineEndpoint({
  method: 'POST',
  path: '/api/upload-content',
  response: UploadContentResponseSchema,
});
