// Shapes for the signed-upload publish flow (issue #561): the remote
// (HTTP) replacement for publish_video (action: from_file). JSON only — no field
// names a file on disk. The caller first mints a signed upload with
// publish_video (action: create_upload), PUTs the video bytes to the returned signedUrl,
// completes it with publish_video (action: complete_upload), and finally publishes by id
// with publish_video (action: publish_upload). Kept in a new module so tools.ts stays
// under the file-size ratchet.
import { z } from 'zod';
import { MAX_UPLOAD_VIDEO_BYTES, MAX_UPLOAD_VIDEO_GB } from './limits.js';
import { PublishVideoDirectShape } from './publish-direct-shape.js';

export const CreateVideoUploadShape = {
  contentType: z
    .enum(['video/mp4', 'video/quicktime'])
    .describe('The real video type: video/mp4 for .mp4, video/quicktime for .mov. The server verifies the actual bytes at completion.'),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_UPLOAD_VIDEO_BYTES)
    .describe(`Exact size of the video in bytes (max ${MAX_UPLOAD_VIDEO_GB}GB).`),
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
