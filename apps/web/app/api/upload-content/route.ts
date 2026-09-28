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

//---------------
// Unified content upload — POST /api/upload-content
// FormData:
//   provider = 'youtube' | 'instagram' | 'bluesky' | 'linkedin'
//   youtube:    video, title, description, tags, privacyStatus, accountIds (repeatable)
//   instagram:  file, caption, igAccountIds (repeatable)
//   bluesky:    video, caption, did (repeatable)
//   linkedin:   video, caption, linkedinAccountIds (repeatable; member id or org URN)
//   engine:     userId (MONEYPRINT_API_SECRET only — internal publish-back)
// Auth = Supabase session (UI) OR Authorization: Bearer <MONEYPRINT_API_SECRET>
// (engine). Per-user rate limit.
//---------------

//---------------
// resolveUploadUserId — identity source for the upload: Supabase session
// (logged-in UI user) or the shared MONEYPRINT_API_SECRET (internal engine
// call, which names the task owner in the form — i.e. the secret may publish
// on behalf of any user). Any other bearer is rejected.
//---------------
async function resolveUploadUserId(
  request: NextRequest,
  formData: FormData,
): Promise<{ userId: string | null; error: NextResponse | null }> {
  const session = await requireSupabaseSession();
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

export async function POST(request: NextRequest) {
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

    // Rate limit por usuário — usa o perfil por operação conforme o provider.
    // O loop multi-conta conta como UMA requisição (o teto por conta é a quota
    // da plataforma destino, não o rate limit local).
    const rateProfile =
      provider === 'youtube'
        ? RATE_LIMITS.youtubeUpload
        : provider === 'bluesky'
          ? RATE_LIMITS.instagramPost
          : RATE_LIMITS.instagramPost;
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
