import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { checkSegmentMedia, uploadSegmentMedia } from './client-user-media.js';
import { MAX_SEGMENT_MEDIA_MB } from './limits.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// Phase 2 user-media tools: upload_media (local file -> mediaId) and
// check_media (mechanical URL check, one code, no LLM). Kept in a new
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

export const UploadMediaDescription =
  `Upload a local image for a video segment and get a mediaId to use in a segment's media field (generate_persona_video). The file is stored as a temporary engine asset (1 hour TTL, same flow as debug uploads): upload shortly before generating, since a scheduled slot far in the future may outlive the asset — in the images modes an expired mediaId fails the task at render (images_do_not_cover_audio names the photo); full lip sync only warns. JPG/JPEG, PNG, or WebP only, max ${MAX_SEGMENT_MEDIA_MB}MB (the engine photo limit). The real content type is validated, not the extension. Returns only the mediaId — never a local path or asset URL.`;

export const CheckMediaDescription =
  'Mechanically check one public image URL for a segment, without an LLM and without judging relevance (the agent, who sees the image, decides relevance). Returns exactly one code: ok, blocked_403 (the host blocked the SSRF-safe download — retry with upload_media bytes fetched on your own machine), not_image, too_small, too_large, timeout, or wrong_aspect (with videoAspect given: the image cannot fill that frame — send one that matches the aspect; the reply carries its probed width and height). No fake User-Agent or Referer is sent to bypass hotlink blocks, and private addresses are never fetched. The URL never appears in the output.';

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
