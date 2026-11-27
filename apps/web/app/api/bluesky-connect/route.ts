import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { BlueskyError, loginToBluesky } from '@/lib/bluesky';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { routeErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { isFilled, readConnectFields } from '@/lib/connect-fields';
import { fetchBlueskyPublicProfile } from '@/lib/bluesky-profile';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { logger } from '@/lib/logger';

async function readBlueskyProfileMetadata(did: string): Promise<Record<string, unknown>> {
  try {
    const profile = await fetchBlueskyPublicProfile(did);
    reportProfileFetched('bluesky', 'connect', { accountName: profile.handle, pictureUrl: profile.avatar });
    return {
      displayName: profile.displayName,
      avatar: profile.avatar,
      profileSyncedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('[bluesky-connect] profile read failed, connecting without it', {
      error: error instanceof Error ? error.message : String(error),
    });
    reportProfileFetchFailed('bluesky', 'connect', error);
    return {};
  }
}

async function readCredentials(request: Request): Promise<
  | { ok: true; handle: string; appPassword: string }
  | { ok: false; error: string }
> {
  const read = await readConnectFields(request, ['handle', 'appPassword']);
  if (!read.ok) return read;
  const { handle, appPassword } = read.fields;
  if (!isFilled(handle)) return { ok: false, error: 'Bluesky handle is required.' };
  if (!isFilled(appPassword)) return { ok: false, error: 'Bluesky app password is required.' };
  return { ok: true, handle: handle.trim(), appPassword };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.blueskyConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return routeErrorResponse(401, 'Authentication required.', 'POST /api/bluesky-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return routeErrorResponse(400, credentials.error, 'POST /api/bluesky-connect');
  }
  const { handle, appPassword } = credentials;

  const supabase = createSupabaseServiceClient();

  try {
    const { did, handle: resolvedHandle } = await loginToBluesky(handle, appPassword);
    const accountMetadata = await readBlueskyProfileMetadata(did);

    const encrypted = encryptTokens({
      access_token: appPassword,
      token_type: 'bluesky_app_password',
      handle: resolvedHandle,
      did,
    });

    const { data: upserted, error: upsertError } = await supabase
      .from('social_accounts')
      .upsert(
        {
          user_id: auth.userId,
          provider: 'bluesky',
          provider_account_id: did,
          account_name: resolvedHandle,
          account_metadata: accountMetadata,
          encrypted_tokens: encrypted,
          needs_reconnect: false,
        },
        { onConflict: 'user_id,provider,provider_account_id' },
      )
      .select('id')
      .single();

    if (upsertError || !upserted) {
      return routeErrorResponse(500, 'Could not save the Bluesky account.', 'POST /api/bluesky-connect', {
        cause: upsertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: upserted.id, did });
  } catch (error) {
    const isInvalidCredentials =
      (error instanceof BlueskyError && error.code === 'invalid_credentials') ||
      (error instanceof Error && error.name === 'BlueskyError' && /Invalid Bluesky/i.test(error.message));
    if (isInvalidCredentials) {
      return routeErrorResponse(422, errorMessage(ERROR_CODES.BLUESKY_CREDENTIAL_REJECTED), 'POST /api/bluesky-connect', {
        code: ERROR_CODES.BLUESKY_CREDENTIAL_REJECTED,
      });
    }
    return routeErrorResponse(500, 'Could not connect the Bluesky account.', 'POST /api/bluesky-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: 'Bluesky connection failed.',
    });
  }
}

export const POST = withApiErrorReporting('POST /api/bluesky-connect', postHandler, { getUserId: resolveReportingUserId });
