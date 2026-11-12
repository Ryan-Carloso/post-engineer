//---------------
// POST /api/videos/uploads/[uploadId]/complete — verify a signed video
// upload (issue #561). The server downloads the object the caller PUT
// through the signed URL and checks the real content (magic bytes via
// lib/media/magic-bytes, through signed-upload.ts) plus the size
// ceiling before marking the row `ready`. Only the owner can complete
// their own upload; a foreign or unknown id is a 404. Completing an
// already-ready upload is an idempotent retry.
//---------------

import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import {
  VideoUploadError,
  completeVideoUpload,
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
} from '@/lib/videos/signed-upload';

const ROUTE = 'POST /api/videos/uploads/[uploadId]/complete';

async function postHandler(
  request: Request,
  context: { params: Promise<{ uploadId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const limited = await applyRateLimit(request, RATE_LIMITS.signedVideoUpload, auth.userId);
  if (limited) return limited;

  const { uploadId } = await context.params;
  try {
    const completed = await completeVideoUpload(
      createSupabaseVideoUploadStore(),
      createSupabaseVideoUploadStorage(),
      auth.userId,
      uploadId,
      new Date(),
    );
    return NextResponse.json({
      success: true,
      uploadId: completed.uploadId,
      status: completed.status,
      contentType: completed.contentType,
      sizeBytes: completed.sizeBytes,
    });
  } catch (error) {
    if (error instanceof VideoUploadError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    throw error;
  }
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
