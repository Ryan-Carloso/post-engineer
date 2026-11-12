// Tools that read files from the local disk. They exist only on the stdio
// server, where the disk is the agent's own machine; the remote (HTTP)
// server never registers them, because a path served over HTTP would
// resolve on the MCP server's filesystem. Extracted from index.ts so it
// stays under the file-size ratchet.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { withTracking } from './analytics.js';
import { MUTATING, DESTRUCTIVE } from './tool-annotations.js';
import { MAX_LIBRARY_IMAGE_MB, MAX_LIBRARY_IMAGES, MAX_UPLOAD_VIDEO_GB, type PostEngineerClient } from './client.js';
import {
  AddPersonaImageShape,
  PublishVideoDirectShape,
  handleAddPersonaImage,
  handlePublishVideoDirect,
} from './tools.js';
import { UploadMediaDescription, UploadMediaShape, handleUploadMedia } from './tools-user-media.js';

export function registerLocalFileTools(server: McpServer, apiClient: PostEngineerClient): void {
  server.tool('upload_media', UploadMediaDescription, UploadMediaShape, MUTATING, withTracking('upload_media', async (args) => handleUploadMedia(apiClient, args)));

  server.tool(
    'add_persona_image',
    `Add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB). Optional tag and description drive the deterministic per-video image selection. The server rejects full libraries (${MAX_LIBRARY_IMAGES} max).`,
    AddPersonaImageShape, MUTATING,
    withTracking('add_persona_image', async (args) => {
      return handleAddPersonaImage(apiClient, args);
    }),
  );

  server.tool(
    'publish_video_direct',
    `Publish a ready-made video file directly to social accounts — no generation, no schedule. Reads a local video (.mp4 or .mov, max ${MAX_UPLOAD_VIDEO_GB}GB) and posts it immediately via POST /api/upload-content. YouTube requires title, description, tags, and privacyStatus; Rumble and Fanvue require title and description; Instagram/Bluesky/LinkedIn/Threads/Facebook/3Speak require caption.`,
    PublishVideoDirectShape, DESTRUCTIVE,
    withTracking('publish_video_direct', async (args) => {
      return handlePublishVideoDirect(apiClient, args);
    }),
  );
}
