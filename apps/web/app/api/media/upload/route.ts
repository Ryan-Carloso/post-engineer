import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { uploadEngineTempAsset } from '@/lib/generation/video-generation';
import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import {
  MULTIPART_OVERHEAD_BYTES,
  boundedFormDataFailureResponse,
  readBoundedFormData,
} from '@/lib/upload/bounded-form-data';

const ROUTE = 'POST /api/media/upload';

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

  const bounded = await readBoundedFormData(request, MAX_SEGMENT_MEDIA_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!bounded.ok) return boundedFormDataFailureResponse(bounded);
  const formData = bounded.formData;

  const file = formData.get('file');
  if (!isFileLike(file) || file.size === 0) {
    return apiErrorResponse(400, 'An image file is required.', { route: ROUTE });
  }
  if (file.size > MAX_SEGMENT_MEDIA_BYTES) {
    return apiErrorResponse(413, 'Image exceeds the 8MB segment media limit.', { route: ROUTE });
  }
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
