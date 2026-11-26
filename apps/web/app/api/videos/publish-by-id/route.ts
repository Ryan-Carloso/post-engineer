import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { assertTrialActive } from '@/lib/trial';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { buildUploadErrorResponse } from '@/lib/upload/handlers';
import { parsePublishBody, publishUploadedVideo } from '@/lib/videos/publish-uploaded';
import {
  VideoUploadError,
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
} from '@/lib/videos/signed-upload';
import { assertUploadNotScheduled } from '@/lib/videos/upload-slot-reference';

const ROUTE = 'POST /api/videos/publish-by-id';

async function postHandler(request: Request): Promise<NextResponse> {
  const logId = logger.generateLogId();
  const startTime = Date.now();

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const limited = await applyRateLimit(request, RATE_LIMITS.publishById, auth.userId);
  if (limited) return limited;
  const trialBlocked = await assertTrialActive(auth.userId, { route: ROUTE });
  if (trialBlocked) return trialBlocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'A JSON body with uploadId, provider and accountIds is required.', {
      route: ROUTE,
      code: 'VIDEO_UPLOAD_INVALID_BODY',
      field: 'uploadId',
    });
  }

  try {
    const input = parsePublishBody(body);
    await assertUploadNotScheduled(createSupabaseServiceClient(), auth.userId, input.uploadId);
    const response = await publishUploadedVideo(
      createSupabaseVideoUploadStore(),
      createSupabaseVideoUploadStorage(),
      auth.userId,
      input,
      logId,
      startTime,
      new Date(),
    );
    const results = 'results' in response ? response.results : [];
    return NextResponse.json({ ...response, successCount: results.filter((r) => r.success).length });
  } catch (error) {
    if (error instanceof VideoUploadError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    if (error instanceof ValidationError) {
      return apiErrorResponse(400, error.message, { route: ROUTE, field: error.field });
    }
    return buildUploadErrorResponse(error, logId, startTime);
  }
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
