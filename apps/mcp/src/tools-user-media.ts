import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { checkSegmentMedia, uploadSegmentMedia } from './client-user-media.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// Phase 2 user-media tools: media (action: upload) (local file -> mediaId) and
// media (action: check) (mechanical URL check, one code, no LLM). Kept in a new
// module so tools.ts stays under the file-size ratchet.
//---------------

export const UploadMediaShape = {
  path: z
    .string()
    .min(1, 'path is required')
    .describe('Local image file path (JPG/JPEG, PNG, or WebP, max 8MB — the engine photo limit, not the 10MB library limit).'),
};

export const UploadMediaSchema = z.object(UploadMediaShape);

export const CheckMediaShape = {
  url: z
    .string()
    .min(1, 'url is required')
    .describe('Public image URL to check mechanically (no LLM, no relevance judgement).'),
  videoAspect: z
    .enum(['9:16', '16:9', '1:1'])
    .optional()
    .describe(
      'Video aspect the image will fill (9:16 Shorts/Instagram, 16:9 long YouTube, 1:1 square). When given, an image that cannot fill the frame returns wrong_aspect instead of ok — send one that matches the aspect.',
    ),
};

export const CheckMediaSchema = z.object(CheckMediaShape);

export async function handleUploadMedia(
  client: PostEngineerClient,
  args: z.infer<typeof UploadMediaSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => {
      const parsed = UploadMediaSchema.parse(args);
      return uploadSegmentMedia(client, parsed.path);
    },
    'uploading segment media',
    'Segment media uploaded successfully',
  );
}

export async function handleCheckMedia(
  client: PostEngineerClient,
  args: z.infer<typeof CheckMediaSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => {
      const parsed = CheckMediaSchema.parse(args);
      return checkSegmentMedia(client, parsed.url, parsed.videoAspect);
    },
    'checking segment media',
    'Segment media check complete',
  );
}
