import { NextRequest, NextResponse } from 'next/server';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { handlePinterestUpload } from '@/lib/upload/pinterest-handler';
import { handleFanvueUpload } from '@/lib/upload/fanvue-handler';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';
import { handleRumbleUpload } from '@/lib/upload/rumble-handler';
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
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { classifyUploadAccountError } from '@/lib/upload/account-error';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import {
  createPublishLedgerClient,
  isValidPublishScopeKey,
  markPublishUnknown,
  mergePartitionResults,
  partitionPublishAccounts,
  recordPublishAttempt,
  recordPartitionResults,
  releaseClaimsForRequestRejection,
  startLedgerHeartbeat,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';

//---------------
// Unified content upload — POST /api/upload-content
// FormData:
//   provider = 'youtube' | 'instagram' | 'bluesky' | 'linkedin' | 'threads' | 'facebook' | 'pinterest' | 'fanvue' | '3speak' | 'rumble'
//   youtube:    video, title, description, tags, privacyStatus, accountIds (repeatable)
//   instagram:  file, caption, igAccountIds (repeatable)
//   bluesky:    video, caption, did (repeatable)
//   linkedin:   video, caption, linkedinAccountIds (repeatable; member id or org URN)
//   threads:    video, caption, threadsAccountIds (repeatable)
//   facebook:   video, caption, facebookAccountIds (repeatable; Page ids)
//   pinterest:  video, title, description, boardId, pinterestAccountIds (repeatable; user ids)
//   fanvue:     video, title, description, fanvueAccountIds (repeatable; Fanvue user uuids)
//   3speak:     video, caption, threespeakAccountIds (repeatable; Hive usernames)
//   rumble:     video, title, description, rumbleAccountIds (repeatable; channel ids)
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

    // No index signature: the handler responses are interfaces without
    // one, and the route only reads success/results — the extra fields
    // (provider, logId, error) still flow through to JSON at runtime.
    type UploadDispatchResult = {
      success: boolean;
      results?: ContentUploadAccountResult[];
    };
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
        response = { success: results.some((result) => result.success), results };
      } else {
        const handlerForm = partition !== null ? partition.formData : formData;
        try {
          response =
          provider === 'youtube'
            ? await handleYoutubeUpload(handlerForm, userId, logId, startTime)
            : provider === 'bluesky'
              ? await handleBlueskyUpload(handlerForm, userId)
              : provider === 'linkedin'
                ? await handleLinkedinUpload(handlerForm, userId)
                : provider === 'threads'
                  ? await handleThreadsUpload(handlerForm, userId)
                  : provider === 'facebook'
                    ? await handleFacebookUpload(handlerForm, userId)
                    : provider === 'pinterest'
                      ? await handlePinterestUpload(handlerForm, userId)
                      : provider === 'fanvue'
                        ? await handleFanvueUpload(handlerForm, userId)
                        : provider === '3speak'
                          ? await handleThreespeakUpload(handlerForm, userId)
                          : provider === 'rumble'
                            ? await handleRumbleUpload(handlerForm, userId)
                            : await handleInstagramUpload(handlerForm, userId, logId, startTime);
        } catch (error) {
          if (partition !== null && ledgerClient !== null) {
          // The handler failed before publishing (validation): release the
          // claims as failed so the next retry proceeds at once instead of
          // waiting out the lease.
            const held = partition;
            const failure = classifyUploadAccountError(error);
            await Promise.all(
              held.granted.map((granted) =>
                recordPublishAttempt(ledgerClient, {
                  scopeKey: held.scopeKey,
                  provider,
                  accountId: granted.accountId,
                  claimToken: granted.claimToken,
                  accountResult: {
                    accountId: granted.accountId,
                    success: false,
                    error: failure.error,
                    errorCode: failure.errorCode,
                  },
                }),
              ),
            );
          }
          throw error;
        }
        if (partition !== null && ledgerClient !== null) {
          const results = response.results;
          const unrecorded = await recordPartitionResults(ledgerClient, partition, results);
          // A success the ledger could not record may already be live: park
          // its claim as unknown so no later retry can claim a fresh
          // publish for it. The response still carries the handler's
          // success — when the caller receives it, its own recorded
          // success keeps the account from retrying at all.
          await Promise.all(
            unrecorded.map((accountId) => {
              const granted = partition.granted.find((item) => item.accountId === accountId);
              if (granted === undefined) return Promise.resolve(false);
              // One const per field: v8 emits no line entries for properties
              // inside an object literal, so an inline argument object reads
              // as uncovered lines to Codecov even when the test runs it.
              const scopeKey = partition.scopeKey;
              const claimToken = granted.claimToken;
              const error = 'publish record lost after a successful post';
              const args = { scopeKey, provider, accountId, claimToken, error };
              return markPublishUnknown(ledgerClient, args);
            }),
          );
          await releaseClaimsForRequestRejection(ledgerClient, partition, results);
          const merged = mergePartitionResults(partition, results);
          response = { ...response, success: merged.some((result) => result.success), results: merged };
        }
      }
    } finally {
      stopHeartbeat?.();
    }

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
export const POST = withApiErrorReporting('POST /api/upload-content', postHandler, { getUserId: resolveReportingUserId });
