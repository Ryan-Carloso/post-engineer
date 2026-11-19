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
import { parseDisconnectAccountQuery } from '@/lib/contracts/accounts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

function isCredentialFailure(error: unknown): boolean {
  return error instanceof TokenDecryptError || isUnauthorizedError(error);
}

async function getHandler(request?: Request) {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Authentication required.' },
      { status: 401 }
    );
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
        return await syncAccountProfile(supabase, userId, record);
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

//---------------
// DELETE /api/account — disconnects (removes) a social account of the logged-in user.
// Query params: provider (any SOCIAL_PROVIDERS entry) and providerAccountId.
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP),
// same as GET.
//---------------

async function deleteHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, message: 'Authentication required.' },
      { status: 401 }
    );
  }

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
