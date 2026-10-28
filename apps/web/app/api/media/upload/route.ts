//---------------
// POST /api/media/upload — segment media upload (MCP upload_media).
//
// The MCP server has no engine secret and must never get one, so it
// cannot call the engine's temp_assets endpoint directly. This route is
// the authenticated bridge: the caller authenticates with a session or
// API key, the route validates the real image type and the 8MB engine
// photo limit, then the server calls the engine's existing temp_assets
// flow with the server secret (uploadEngineTempAsset). The response
// carries only the mediaId: the temp asset URL is a capability (its UUID
// filename) and never leaves the server, and the engine resolves the
// mediaId from its own temp_assets directory at task start.
//
// Temp assets expire after 1 hour: upload shortly before generating. A
// scheduled slot far in the future may outlive the asset; the engine
// then skips that segment's photo with a task warning instead of
// failing the video.
//---------------

import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { uploadEngineTempAsset } from '@/lib/generation/video-generation';
import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

const ROUTE = 'POST /api/media/upload';

// The engine photo bottleneck (place_photos MAX_PHOTO_BYTES), not the
// 10MB persona library limit: a larger segment upload could never render.
const MAX_SEGMENT_MEDIA_BYTES = 8 * 1024 * 1024;
const TEMP_ASSET_TTL_SECONDS = 60 * 60;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MEDIA_ID_PATTERN = /^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$/;

function isFileLike(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    typeof (value as { size?: unknown }).size === 'number'
  );
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.mediaUpload);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiErrorResponse(400, 'Invalid multipart payload.', { route: ROUTE });
  }

  const file = formData.get('file');
  if (!isFileLike(file) || file.size === 0) {
    return apiErrorResponse(400, 'An image file is required.', { route: ROUTE });
  }
  if (file.size > MAX_SEGMENT_MEDIA_BYTES) {
    return apiErrorResponse(413, 'Image exceeds the 8MB segment media limit.', { route: ROUTE });
  }
  // Real content type, never the declared MIME or the filename: both are
  // client-controlled and spoofable. Only the types the temp_assets flow
  // accepts by suffix pass, so the engine never receives a mismatched file.
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = detectMagicMimeType(buffer);
  const extension = mimeType === null ? undefined : MIME_TO_EXTENSION[mimeType];
  if (extension === undefined) {
    return apiErrorResponse(400, 'Image must be a JPG, PNG, or WebP file.', { route: ROUTE });
  }

  const assetUrl = await uploadEngineTempAsset(auth.userId, file, extension);
  if (assetUrl === undefined) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  // The mediaId is the UUID filename the engine itself minted. The full
  // URL is never returned: it is the download capability.
  let mediaId: string | undefined;
  try {
    mediaId = new URL(assetUrl).pathname.split('/').pop();
  } catch {
    mediaId = undefined;
  }
  if (mediaId === undefined || !MEDIA_ID_PATTERN.test(mediaId)) {
    return apiErrorResponse(502, 'Video service is unavailable.', { route: ROUTE });
  }
  return NextResponse.json({ success: true, mediaId, expiresInSeconds: TEMP_ASSET_TTL_SECONDS });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
