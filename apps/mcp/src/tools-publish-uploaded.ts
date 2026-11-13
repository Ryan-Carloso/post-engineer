import type { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { completeVideoUpload, createVideoUpload, publishUploadedVideo } from './client-publish-uploaded.js';
import { ApiError, getErrorMessage } from './errors.js';
import {
  CompleteVideoUploadSchema,
  CreateVideoUploadSchema,
  PublishUploadedVideoSchema,
} from './publish-uploaded-shape.js';
import { sanitizeEngineError } from './tools.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// Signed-upload publish tools (issue #561): the JSON-only remote flow
// that replaces publish_video_direct's local videoPath. Kept in a new
// module so tools.ts stays under the file-size ratchet; registration
// lives in publish-uploaded-tools.ts. sanitizeEngineError is imported
// from tools.ts (the same import cycle local-file-tools.ts already has
// through tools.js — handlers run after module init).
//---------------

export const CreateVideoUploadDescription =
  'Mint a short-lived signed upload for one video (MP4 or MOV, max 2GB): returns an uploadId plus a signedUrl to PUT the video bytes to directly (the bytes never pass through this server), bound to your account and expiring in 15 minutes. Then call complete_video_upload, then publish_uploaded_video with the uploadId.';

export const CompleteVideoUploadDescription =
  'Verify a signed video upload after its bytes were PUT to the signedUrl from create_video_upload: the server checks the real video content (magic bytes) and size, and marks the upload ready to publish. Completing an already-ready upload is safe to retry.';

export const PublishUploadedVideoDescription =
  'Publish a completed signed-upload video directly to social accounts by uploadId — no generation, no schedule, no local path. Single-use: one publish consumes the upload. YouTube requires title, description, tags, and privacyStatus; Rumble and Fanvue require title and description; Instagram/Bluesky/LinkedIn/Threads/Facebook/3Speak require caption; Pinterest requires boardId (plus description or caption). Create the upload first with create_video_upload and verify it with complete_video_upload.';

export async function handleCreateVideoUpload(
  client: PostEngineerClient,
  args: z.infer<typeof CreateVideoUploadSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => createVideoUpload(client, CreateVideoUploadSchema.parse(args)),
    'creating video upload',
    'Signed video upload created. PUT the video bytes to signedUrl before it expires, then call complete_video_upload',
  );
}

export async function handleCompleteVideoUpload(
  client: PostEngineerClient,
  args: z.infer<typeof CompleteVideoUploadSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => completeVideoUpload(client, CompleteVideoUploadSchema.parse(args).uploadId),
    'completing video upload',
    'Video upload verified and ready to publish',
  );
}

export async function handlePublishUploadedVideo(
  client: PostEngineerClient,
  args: z.infer<typeof PublishUploadedVideoSchema>,
): Promise<McpToolResponse> {
  try {
    const input = PublishUploadedVideoSchema.parse(args);
    const result = await publishUploadedVideo(client, input);
    const lines = result.results.map((account) => {
      if (account.success) {
        const link = account.videoUrl ?? account.permalink ?? account.postId ?? account.videoId ?? '';
        return `- ${account.accountId}: published${link ? ` (${link})` : ''}`;
      }
      return `- ${account.accountId}: FAILED — ${account.error ?? 'unknown error'}`;
    });
    return {
      content: [
        {
          type: 'text',
          text:
            `Published uploaded video to ${result.provider}: ${result.successCount}/${result.results.length} accounts succeeded.\n` +
            lines.join('\n') +
            `\n${JSON.stringify({
              success: result.success,
              provider: result.provider,
              successCount: result.successCount,
              results: result.results,
              logId: result.logId,
            })}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error publishing uploaded video: ${JSON.stringify({
              code: error.code,
              message: sanitizeEngineError(getErrorMessage(error)),
              field: error.field,
            })}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Error publishing uploaded video: ${getErrorMessage(error)}` }],
      isError: true,
    };
  }
}
