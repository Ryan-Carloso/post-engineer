import { z } from 'zod';
import { MAX_UPLOAD_VIDEO_BYTES, MAX_UPLOAD_VIDEO_GB } from './limits.js';
import { PublishVideoDirectShape } from './publish-direct-shape.js';
import { MAX_IMAGE_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from './contracts/videos.js';

export const CreateVideoUploadShape = {
  contentType: z
    .enum(UPLOAD_CONTENT_TYPES)
    .describe('The real type: video/mp4 (.mp4), video/quicktime (.mov), image/jpeg or image/png. The server verifies the bytes at completion.'),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_UPLOAD_VIDEO_BYTES)
    .describe(`Exact size in bytes (max ${MAX_UPLOAD_VIDEO_GB}GB video, ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)} MB image).`),
};

export const CreateVideoUploadSchema = z.object(CreateVideoUploadShape).strict();

export const CompleteVideoUploadShape = {
  uploadId: z
    .string()
    .min(1, 'uploadId is required')
    .describe('The uploadId returned by publish_video (action: create_upload), after the bytes were PUT to its signedUrl.'),
};

export const CompleteVideoUploadSchema = z.object(CompleteVideoUploadShape).strict();

export const PublishUploadedVideoShape = {
  provider: PublishVideoDirectShape.provider,
  uploadId: z
    .string()
    .min(1, 'uploadId is required')
    .describe('The uploadId of a completed signed upload (publish_video (action: create_upload) + publish_video (action: complete_upload)). Single-use: one publish consumes it.'),
  accountIds: PublishVideoDirectShape.accountIds,
  title: PublishVideoDirectShape.title,
  description: PublishVideoDirectShape.description,
  tags: PublishVideoDirectShape.tags,
  privacyStatus: PublishVideoDirectShape.privacyStatus,
  caption: PublishVideoDirectShape.caption,
  boardId: PublishVideoDirectShape.boardId,
};

export const PublishUploadedVideoSchema = z.object(PublishUploadedVideoShape).strict();
