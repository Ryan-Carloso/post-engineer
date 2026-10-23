import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { cancelVideoTask } from './client-video-task.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// cancel_video_task — MCP tool over DELETE /api/persona/video-task/[taskId].
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet.
//---------------

export const CancelVideoTaskShape = {
  taskId: z
    .string()
    .min(1, 'taskId is required')
    .describe(
      'Engine task id of the video to cancel (taskId from get_video_status, get_video_task_progress, get_post or list_posts). Only your own task can be cancelled.',
    ),
};

export const CancelVideoTaskSchema = z.object(CancelVideoTaskShape);

export async function handleCancelVideoTask(
  client: PostEngineerClient,
  args: z.infer<typeof CancelVideoTaskSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => cancelVideoTask(client, args.taskId), 'cancelling video task');
}
