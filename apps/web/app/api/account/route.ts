import { NextResponse } from 'next/server';
import { listSocialAccounts, deleteSocialAccount } from '@/lib/social-accounts';
import { toPublicAccountSafe, type PublicAccountItem, type SocialProvider } from '@/lib/providers/registry';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { syncAccountProfile, credentialFailureHeld } from '@/lib/account-profile-sync';
import { TokenDecryptError } from '@/lib/token-crypto';
import { isUnauthorizedError } from '@/lib/upload/account-unauthorized';
import { logger } from '@/lib/logger';
import { parseDisconnectAccountQuery, parseListAccountsQuery } from '@/lib/contracts/accounts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller, RATE_LIMITS } from '@/lib/rate-limit';

function isCredentialFailure(error: unknown): boolean {
  return error instanceof TokenDecryptError || isUnauthorizedError(error);
}

async function getHandler(request: Request) {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Authentication required.' },
      { status: 401 }
    );
  }
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.accountList), auth.userId);
  if (limited) return limited;
  const parsed = parseListAccountsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { authenticated: true, accounts: [], message: parsed.error, error: parsed.code },
      { status: 400 }
    );
  }
  if (parsed.refresh) {
    const refreshLimited = await applyRateLimit(request, RATE_LIMITS.accountProfileRefresh, auth.userId);
    if (refreshLimited) return refreshLimited;
  }
  const userId = auth.userId;
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  try {
    const records = await listSocialAccounts(supabase, userId);
    const failedRecordIds = new Set<string>();
    const effectiveRecords = await Promise.all(records.map(async (record) => {
      try {
        return await syncAccountProfile(supabase, userId, record, { force: parsed.refresh });
      } catch (error) {
        logger.error('[ACCOUNT] Profile sync failed, keeping the stored profile', error, { recordId: record.id, provider: record.provider });
        if (isCredentialFailure(error)) failedRecordIds.add(record.id);
        return record;
      }
    }));
    const now = new Date();
    const accounts: PublicAccountItem[] = [];
    for (const effectiveRecord of effectiveRecords) {
      const broken = failedRecordIds.has(effectiveRecord.id) || credentialFailureHeld(effectiveRecord, now) || effectiveRecord.needsReconnect === true;
      const mapped = toPublicAccountSafe(effectiveRecord, broken ? 'error' : 'ok');
      if (mapped) {
        accounts.push(mapped);
      } else {
        logger.error('[ACCOUNT] Dropped a row with an unknown provider', undefined, { recordId: effectiveRecord.id, provider: effectiveRecord.provider });
      }
    }

    return NextResponse.json({
      authenticated: true,
      accounts,
      message: 'Accounts retrieved from Supabase',
    });
  } catch (error) {
    logger.error('[ACCOUNT] Failed to list accounts', error);
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Failed to list accounts.', error: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}

async function deleteHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, message: 'Authentication required.' },
      { status: 401 }
    );
  }
  const limited = await applyRateLimit(request, RATE_LIMITS.accountDisconnect, auth.userId);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const parsed = parseDisconnectAccountQuery(params);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.code, message: parsed.error },
      { status: 400 }
    );
  }
  const { provider, providerAccountId } = parsed.query;

  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  try {
    await deleteSocialAccount(supabase, auth.userId, provider as SocialProvider, providerAccountId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[ACCOUNT] Failed to disconnect account', error);
    return NextResponse.json(
      { success: false, message: 'Failed to disconnect account.', error: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}

export const GET = withApiErrorReporting('GET /api/account', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/account', deleteHandler, { getUserId: resolveReportingUserId });
