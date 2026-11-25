import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { isVideoType, unknownVideoTypeMessage, type VideoType } from '@/lib/tokens';
import {
  HOOK_MAX_SECONDS,
  HOOK_MIN_SECONDS,
  validateSegments,
} from '@/lib/generation/script-segments';
import { checkHookTitle, hookTitleIssueMessage } from '@/lib/generation/hook-title';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const ROUTE = 'POST /api/videos/validate-script';

export const MEASURED_DURATION_PENDING_REASON =
  'No hook-only TTS endpoint exists yet, so the measured hook duration cannot be checked in this phase.';

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.validateScript, auth.userId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      route: ROUTE,
    });
  }
  const fields = typeof body === 'object' && body !== null ? (body as { segments?: unknown; videoType?: unknown; hookTitle?: unknown }) : {};
  let videoType: VideoType = 'hook_lipsync';
  if (fields.videoType !== undefined) {
    if (!isVideoType(fields.videoType)) {
      return apiErrorResponse(400, unknownVideoTypeMessage(fields.videoType), {
        code: ERROR_CODES.VALIDATION_FAILED,
        field: 'videoType',
        route: ROUTE,
      });
    }
    videoType = fields.videoType;
  }
  if (fields.hookTitle !== undefined) {
    if (typeof fields.hookTitle !== 'string') {
      return apiErrorResponse(400, 'hookTitle must be a string.', {
        code: ERROR_CODES.VALIDATION_FAILED,
        field: 'hookTitle',
        route: ROUTE,
      });
    }
    const hookTitleCode = checkHookTitle(fields.hookTitle);
    if (hookTitleCode !== null) {
      return apiErrorResponse(400, hookTitleIssueMessage(hookTitleCode), {
        code: hookTitleCode,
        field: 'hookTitle',
        route: ROUTE,
      });
    }
  }
  const result = validateSegments(fields.segments, videoType);
  if (!result.ok) {
    return apiErrorResponse(400, `${result.error.rule} Fix: ${result.error.fix}`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: result.error.field,
      route: ROUTE,
      extra: { rule: result.error.rule, fix: result.error.fix },
    });
  }
  const value = result.value;
  return NextResponse.json({
    success: true,
    valid: true,
    segmentCount: value.segmentCount,
    totalWords: value.totalWords,
    hookWords: value.hookWords,
    contentWords: value.contentWords,
    mediaCount: value.mediaCount,
    hookWindowSeconds: { min: HOOK_MIN_SECONDS, max: HOOK_MAX_SECONDS },
    measuredDurationSeconds: null,
    measured: 'pending',
    measuredReason: MEASURED_DURATION_PENDING_REASON,
  });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
