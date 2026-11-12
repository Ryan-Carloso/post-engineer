// Registration for the signed-upload publish tools (issue #561).
// Registered on BOTH transports: the shapes are JSON-only (no local
// path), so the remote (HTTP) server offers them, and stdio callers may
// use the same flow. The stdio bridge that would feed a local videoPath
// through this flow automatically is out of scope — publish_video_direct
// keeps working unchanged on stdio. Extracted from index.ts so it stays
// under the file-size ratchet.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { withTracking } from './analytics.js';
import { MUTATING, DESTRUCTIVE } from './tool-annotations.js';
import type { PostEngineerClient } from './client.js';
import {
  CompleteVideoUploadShape,
  CreateVideoUploadShape,
  PublishUploadedVideoShape,
} from './publish-uploaded-shape.js';
import {
  CompleteVideoUploadDescription,
  CreateVideoUploadDescription,
  PublishUploadedVideoDescription,
  handleCompleteVideoUpload,
  handleCreateVideoUpload,
  handlePublishUploadedVideo,
} from './tools-publish-uploaded.js';

export function registerPublishUploadedTools(server: McpServer, apiClient: PostEngineerClient): void {
  server.tool(
    'create_video_upload',
    CreateVideoUploadDescription,
    CreateVideoUploadShape, MUTATING,
    withTracking('create_video_upload', async (args) => handleCreateVideoUpload(apiClient, args)),
  );

  server.tool(
    'complete_video_upload',
    CompleteVideoUploadDescription,
    CompleteVideoUploadShape, MUTATING,
    withTracking('complete_video_upload', async (args) => handleCompleteVideoUpload(apiClient, args)),
  );

  server.tool(
    'publish_uploaded_video',
    PublishUploadedVideoDescription,
    PublishUploadedVideoShape, DESTRUCTIVE,
    withTracking('publish_uploaded_video', async (args) => handlePublishUploadedVideo(apiClient, args)),
  );
}
