import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import { withTracking } from './analytics.js';
import type { PostEngineerClient } from './client.js';
import { GenerateVideoDescription, GenerateVideoShape, handleGenerateVideo } from './generate-video.js';
import type { RecipeSession } from './recipe-session.js';
import { DESTRUCTIVE, MUTATING, READ_ONLY } from './tool-annotations.js';
import { GetVideoGenerationShape, ListVideoGenerationsShape, handleGetVideoGeneration, handleListVideoGenerations } from './tools.js';
import { withScriptOutcome } from './tools-prompts.js';
import { CancelVideoTaskShape, WaitForVideoTasksShape, handleCancelVideoTask, handleWaitForVideoTasks } from './video-task-tools.js';

const VIDEO_TASKS_SPECS = {
  status: WaitForVideoTasksShape,
  list_generations: ListVideoGenerationsShape,
  get_generation: GetVideoGenerationShape,
};

export const VideoTasksDescription = actionDescription(
  'For the final outcome, call status with waitSeconds above 0 (one server-side wait). A snapshot (waitSeconds 0) is only progress: wait at least nextPollInSeconds. On timeout, call again with unfinished taskIds. list_generations / get_generation: generation history.',
  VIDEO_TASKS_SPECS,
);

export function registerVideoTools(server: McpServer, client: PostEngineerClient, session: RecipeSession): void {
  server.tool(
    'generate_video',
    GenerateVideoDescription,
    GenerateVideoShape,
    MUTATING,
    withTracking('generate_video', withScriptOutcome(session, 'generate_video', async (args) => handleGenerateVideo(client, args), (args) => args.videos.map((video) => ({ segments: video.segments, videoType: video.options?.videoType })))),
  );

  server.tool(
    'video_tasks',
    VideoTasksDescription,
    actionShape(VIDEO_TASKS_SPECS),
    READ_ONLY,
    byAction(
      {
        status: (args) => handleWaitForVideoTasks(client, args),
        list_generations: (args) => handleListVideoGenerations(client, args),
        get_generation: (args) => handleGetVideoGeneration(client, args),
      },
      VIDEO_TASKS_SPECS,
      'video_tasks',
    ),
  );

  server.tool(
    'cancel_video',
    'Cancel a video that is still generating (your own task only). Kept apart from video_tasks so a client can allow status checks without allowing cancellation.',
    CancelVideoTaskShape,
    DESTRUCTIVE,
    withTracking('cancel_video', async (args) => handleCancelVideoTask(client, args)),
  );
}
