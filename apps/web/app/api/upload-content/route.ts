import { NextRequest, NextResponse } from 'next/server';
import { assertAccessActive } from '@/lib/access';
import type { ApprovalMode } from '@/lib/api-keys';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/lib/errors';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { buildUploadErrorResponse } from '@/lib/upload/handlers';
import { publishContent } from '@/lib/upload/publish-content';
import { SOCIAL_PROVIDERS, isSocialProvider } from '@/lib/providers/registry';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { boundedFormDataFailureResponse, readBoundedFormData } from '@/lib/upload/bounded-form-data';
import { UPLOAD_CONTENT_MAX_BODY_BYTES } from '@/lib/upload/upload-content-limits';

type UploadAuth =
  | { kind: 'session'; userId: string; isApiKey?: boolean; approvalMode?: ApprovalMode }
  | { kind: 'denied'; error: NextResponse };

async function authenticateUpload(request: NextRequest): Promise<UploadAuth> {
  const session = await requireSupabaseSession(request);
  if (session.auth) {
    return {
      kind: 'session',
      userId: session.auth.userId,
      isApiKey: session.auth.isApiKey,
      approvalMode: session.auth.approvalMode,
    };
  }

  return {
    kind: 'denied',
    error:
      session.error ??
      NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
  };
}

async function postHandler(request: NextRequest) {
  const logId = logger.generateLogId();
  const startTime = Date.now();

  try {
    const upload = await authenticateUpload(request);
    if (upload.kind === 'denied') return upload.error;
    if (upload.isApiKey === true && upload.approvalMode === 'approval') {
      return NextResponse.json(
        { success: false, error: 'Approval-mode API keys cannot publish directly.' },
        { status: 403 },
      );
    }

    const bounded = await readBoundedFormData(request, UPLOAD_CONTENT_MAX_BODY_BYTES);
    if (!bounded.ok) return boundedFormDataFailureResponse(bounded);
    const formData = bounded.formData;

    const userId = upload.userId;
    const provider = formData.get('provider');

    if (!isSocialProvider(provider)) {
      throw new ValidationError(
        `Invalid provider. Use one of: ${SOCIAL_PROVIDERS.join(', ')}`,
        'provider',
      );
    }

    const rateProfile =
      provider === 'youtube'
        ? RATE_LIMITS.youtubeUpload
        : provider === 'pinterest'
          ? RATE_LIMITS.pinterestUpload
          : RATE_LIMITS.instagramPost;
    const limited = await applyRateLimit(request, rateProfile, userId);
    if (limited) return limited;
    const blocked = await assertAccessActive(userId, { route: 'POST /api/upload-content' });
    if (blocked) return blocked;

    logger.info('[upload-content] request recebido', {
      logId,
      metadata: {
        provider,
        userId,
        fields: Array.from(formData.keys()),
      },
    });

    logger.logUploadStart(logId, {
      endpoint: '/api/upload-content',
      method: 'POST',
      timestamp: new Date().toISOString(),
    });

    const result = await publishContent({
      provider,
      userId,
      formData,
      scopeKeyRaw: formData.get('publishScopeKey'),
      logId,
      startTime,
    });
    if (!result.ok) {
      logger.error('[upload-content] ERRO', result.cause, { logId });
      return buildUploadErrorResponse(result.cause, logId, startTime);
    }
    const response = result.response;
    return NextResponse.json(response);
  } catch (error) {
    logger.error('[upload-content] ERRO', error, { logId });
    return buildUploadErrorResponse(error, logId, startTime);
  }
}

export const POST = withApiErrorReporting('POST /api/upload-content', postHandler, { getUserId: resolveReportingUserId });
