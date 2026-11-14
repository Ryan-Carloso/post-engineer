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
// Signed-upload publish handlers (issue #561): the JSON-only remote flow
// that replaces the local videoPath of publish_video (action: from_file).
// Kept in a new module so tools.ts stays under the file-size ratchet; the
// publish_video tool registers them in intent-content.ts. sanitizeEngineError
// is imported from tools.ts (an import cycle through tools.js that is safe:
// handlers run after module init).
//---------------

export async function handleCreateVideoUpload(
  client: PostEngineerClient,
  args: z.infer<typeof CreateVideoUploadSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => createVideoUpload(client, CreateVideoUploadSchema.parse(args)),
    'creating video upload',
    'Signed video upload created. PUT the video bytes to signedUrl before it expires, then call publish_video (action: complete_upload)',
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
