import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/lib/errors';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { secretsMatch } from '@/lib/secrets';
import { buildUploadErrorResponse } from '@/lib/upload/handlers';
import { PUBLISH_HANDLERS, type PublishHandlerResponse } from '@/lib/upload/publish-handlers';
import { SOCIAL_PROVIDERS, isSocialProvider } from '@/lib/providers/registry';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  createPublishLedgerClient,
  isValidPublishScopeKey,
  mergePartitionResults,
  partitionPublishAccounts,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';
import { releaseGrantedClaims, settlePartition } from '@/lib/upload/publish-ledger-settle';
import { startLedgerHeartbeat } from '@/lib/upload/publish-ledger-heartbeat';

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

    const rateProfile =
      provider === 'youtube'
        ? RATE_LIMITS.youtubeUpload
        : provider === 'pinterest'
          ? RATE_LIMITS.pinterestUpload
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

    const scopeKeyRaw = formData.get('publishScopeKey');
    const scopeKey = isValidPublishScopeKey(scopeKeyRaw) ? scopeKeyRaw : null;
    const ledgerClient = scopeKey !== null ? createPublishLedgerClient() : null;
    let partition: PublishLedgerPartition | null = null;
    if (scopeKey !== null && ledgerClient !== null) {
      partition = await partitionPublishAccounts(ledgerClient, scopeKey, provider, userId, formData);
    }

    // The ledger branches recompute successCount from the merged results,
    // so a replayed success is counted (the handler's count only covers
    // fresh publishes).
    type UploadDispatchResult = PublishHandlerResponse;
    // Heartbeat: while this request publishes, it renews its claims, so
    // a publish longer than the lease is never taken over while alive.
    // Stopped in the finally once the handler finished and the outcomes
    // are recorded — including the handler-throw path, which records the
    // claims as failed before rethrowing.
    const stopHeartbeat =
      partition !== null && partition.granted.length > 0 && ledgerClient !== null
        ? startLedgerHeartbeat(ledgerClient, partition)
        : null;
    let response: UploadDispatchResult;
    try {
      if (partition !== null && partition.granted.length === 0) {
        const results = mergePartitionResults(partition, []);
        response = {
          success: results.some((result) => result.success),
          successCount: results.filter((result) => result.success).length,
          results,
        };
      } else {
        const handlerForm = partition !== null ? partition.formData : formData;
        try {
          response = await PUBLISH_HANDLERS[provider](handlerForm, userId, logId, startTime);
        } catch (error) {
          if (partition !== null && ledgerClient !== null) {
            await releaseGrantedClaims(ledgerClient, partition, error);
          }
          throw error;
        }
        if (partition !== null && ledgerClient !== null) {
          const merged = await settlePartition(ledgerClient, partition, response.results);
          response = {
            ...response,
            success: merged.some((result) => result.success),
            successCount: merged.filter((result) => result.success).length,
            results: merged,
          };
        }
      }
    } finally {
      stopHeartbeat?.();
    }

    logger.info('[upload-content] handler finalizado', { provider, success: response.success, logId });
    return NextResponse.json(response);
  } catch (error) {
    logger.error('[upload-content] ERRO', error, { logId });
    return buildUploadErrorResponse(error, logId, startTime);
  }
}

export const POST = withApiErrorReporting('POST /api/upload-content', postHandler, { getUserId: resolveReportingUserId });
