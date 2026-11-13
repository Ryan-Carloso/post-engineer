//---------------
// POST /api/videos/upload-url — mint a signed video upload (issue #561).
//
// The remote replacement for a local video path: the authenticated
// caller declares the video type and size, and gets back one short-lived
// signed upload URL bound to their own row in `video_uploads` (owner,
// expiry and the 2GB ceiling are recorded server-side). The caller PUTs
// the bytes straight to storage, then completes the upload
// (POST /api/videos/uploads/[uploadId]/complete) and publishes it by id
// (POST /api/videos/publish-by-id). The signed URL is a capability for
// this caller's own upload only — it is minted for the authenticated
// owner and recorded against their id.
//---------------

import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import {
  VideoUploadError,
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
  mintVideoUpload,
  parseMintBody,
} from '@/lib/videos/signed-upload';

const ROUTE = 'POST /api/videos/upload-url';

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const limited = await applyRateLimit(request, RATE_LIMITS.signedVideoUpload, auth.userId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'A JSON body with contentType and sizeBytes is required.', {
      route: ROUTE,
      code: 'VIDEO_UPLOAD_INVALID_BODY',
      field: 'contentType',
    });
  }

  try {
    const input = parseMintBody(body);
    const minted = await mintVideoUpload(
      createSupabaseVideoUploadStore(),
      createSupabaseVideoUploadStorage(),
      auth.userId,
      input,
      new Date(),
    );
    return NextResponse.json({
      success: true,
      uploadId: minted.uploadId,
      signedUrl: minted.signedUrl,
      token: minted.token,
      storagePath: minted.storagePath,
      expiresAt: minted.expiresAt,
      maxBytes: minted.maxBytes,
    });
  } catch (error) {
    if (error instanceof VideoUploadError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    throw error;
  }
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
