import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/lib/errors';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { secretsMatch } from '@/lib/secrets';
import {
  handleYoutubeUpload,
  handleInstagramUpload,
  handleBlueskyUpload,
  handleLinkedinUpload,
  buildUploadErrorResponse,
} from '@/lib/upload/handlers';
import { SOCIAL_PROVIDERS, isSocialProvider } from '@/lib/providers/registry';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// Unified content upload — POST /api/upload-content
// FormData:
//   provider = 'youtube' | 'instagram' | 'bluesky' | 'linkedin'
//   youtube:    video, title, description, tags, privacyStatus, accountIds (repeatable)
//   instagram:  file, caption, igAccountIds (repeatable)
//   bluesky:    video, caption, did (repeatable)
//   linkedin:   video, caption, linkedinAccountIds (repeatable; member id or org URN)
//   engine:     userId (MONEYPRINT_API_SECRET only — internal publish-back)
// Auth = Supabase session (UI), personal API key (pe_live_...), or
// Authorization: Bearer <MONEYPRINT_API_SECRET> (engine). Per-user rate limit.
//---------------

//---------------
// resolveUploadUserId — identity source for the upload: Supabase session
// (logged-in UI user), a personal API key (pe_live_...), or the shared
// MONEYPRINT_API_SECRET (internal engine call, which names the task owner
// in the form — i.e. the secret may publish on behalf of any user). Any
// other bearer is rejected.
// Passing the request to requireSupabaseSession enables its API-key
// (Bearer / x-api-key) and OAuth branches — the same pattern every other
// API-key-capable route uses. The engine shared secret is not
// pe_live_-prefixed, so its bearer falls through those branches to the
// secretsMatch check below unchanged. API-key callers publish as the key
// owner: a form userId is only honored on the engine-secret path.
//---------------
async function resolveUploadUserId(
  request: NextRequest,
  formData: FormData,
): Promise<{ userId: string | null; error: NextResponse | null }> {
  const session = await requireSupabaseSession(request);
  if (session.auth) return { userId: session.auth.userId, error: null };

  const apiSecret = process.env.MONEYPRINT_API_SECRET;
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
  if (apiSecret && bearer && secretsMatch(bearer, apiSecret)) {
    const userId = formData.get('userId');
    if (typeof userId === 'string' && userId.length > 0) {
      return { userId, error: null };
    }
  }

  return {
    userId: null,
    error: session.error,
  };
}

async function postHandler(request: NextRequest) {
  const logId = logger.generateLogId();
  const startTime = Date.now();

  try {
    const formData = await request.formData();
    const { userId, error: authError } = await resolveUploadUserId(request, formData);
    if (authError || !userId) {
      return authError ?? NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 },
      );
    }

    const provider = formData.get('provider');

    if (!isSocialProvider(provider)) {
      throw new ValidationError(
        `Invalid provider. Use one of: ${SOCIAL_PROVIDERS.join(', ')}`,
        'provider',
      );
    }

    // Per-user rate limit — uses the per-operation profile for the provider.
    // The multi-account loop counts as ONE request (the per-account ceiling
    // is the destination platform's quota, not the local rate limit).
    // Only YouTube has a dedicated profile; every other provider shares the
    // instagram-post profile.
    const rateProfile =
      provider === 'youtube' ? RATE_LIMITS.youtubeUpload : RATE_LIMITS.instagramPost;
    const limited = await applyRateLimit(request, rateProfile, userId);
    if (limited) return limited;

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

    const response =
      provider === 'youtube'
        ? await handleYoutubeUpload(formData, userId, logId, startTime)
        : provider === 'bluesky'
          ? await handleBlueskyUpload(formData, userId)
          : provider === 'linkedin'
            ? await handleLinkedinUpload(formData, userId)
            : await handleInstagramUpload(formData, userId, logId, startTime);

    logger.info('[upload-content] handler finalizado', { provider, success: response.success, logId });
    return NextResponse.json(response);
  } catch (error) {
    logger.error('[upload-content] ERRO', undefined, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'UNKNOWN',
    });
    return buildUploadErrorResponse(error, logId, startTime);
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/upload-content', postHandler);
