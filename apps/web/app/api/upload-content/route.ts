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

//---------------
// Unified content upload — POST /api/upload-content
// FormData:
//   provider = one of SOCIAL_PROVIDERS (shared/contracts/providers.ts)
//   youtube:    video, title, description, tags, privacyStatus, accountIds (repeatable)
//   instagram:  file xor videoStoragePath, caption, igAccountIds (repeatable)
//   bluesky:    video, caption, did (repeatable)
//   linkedin:   video, caption, linkedinAccountIds (repeatable; member id or org URN)
//   threads:    video xor videoStoragePath, caption, threadsAccountIds (repeatable)
//   facebook:   video xor videoStoragePath, caption, facebookAccountIds (repeatable; Page ids)
// videoStoragePath is an engine-archived R2 key
// `{userId}/{persona|faceless}/{taskId}/final-1.mp4`: the handler presigns
// it directly instead of uploading a publish-media copy.
//   pinterest:  video, title, description, boardId, pinterestAccountIds (repeatable; user ids)
//   fanvue:     video, title, description, fanvueAccountIds (repeatable; Fanvue user uuids)
//   3speak:     video, caption, threespeakAccountIds (repeatable; Hive usernames)
//   rumble:     video, title, description, rumbleAccountIds (repeatable; channel ids)
//   telegram:   video|image|audio, caption, telegramAccountIds (repeatable; chat ids)
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
    // Only YouTube and Pinterest have dedicated profiles; every other
    // provider — Fanvue included — shares the instagram-post profile.
    // (Verified: lib/rate-limit.ts has no provider enum, so no change
    // there was needed for Fanvue.)
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

    // Publish ledger — a retry of the same slot/video must not post again.
    // The engine sends a deterministic `publishScopeKey` (slot + video);
    // a direct caller sends `direct:<key>`. Without a valid key the
    // request publishes exactly as before: no ledger, no behaviour change.
    // A claim failure fails closed (500): publishing without the ledger
    // could duplicate the post, so the engine retries later instead.
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
      // Every account already published or still in flight: nothing to call.
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
          // The handler failed before publishing (validation): release the
          // claims as failed so the next retry proceeds at once instead of
          // waiting out the lease.
            await releaseGrantedClaims(ledgerClient, partition, error);
          }
          throw error;
        }
        if (partition !== null && ledgerClient !== null) {
          // A success the ledger could not record may already be live: the
          // settle parks its claim as unknown so no later retry can claim a
          // fresh publish for it. The response still carries the handler's
          // success — when the caller receives it, its own recorded
          // success keeps the account from retrying at all.
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
    // Pass the error itself as the cause: the logger reports it to
    // PostHog, so the real message surfaces instead of 'Unknown error'
    // with the message buried in metadata. The log id stays as metadata
    // for correlation with the client-facing errorId.
    logger.error('[upload-content] ERRO', error, { logId });
    return buildUploadErrorResponse(error, logId, startTime);
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/upload-content', postHandler, { getUserId: resolveReportingUserId });
