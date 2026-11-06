import { NextResponse } from 'next/server';
import { listSocialAccounts, deleteSocialAccount } from '@/lib/social-accounts';
import { toPublicAccountSafe, type PublicAccountItem, SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { syncInstagramProfile } from '@/lib/instagram-profile-sync';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/account — lists all social accounts of the logged-in user (NO tokens).
// The per-provider shape comes from the registry (lib/providers/registry.ts);
// an unknown provider is dropped with a server-side log (only the bad row
// disappears, not the list).
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
//---------------
async function getHandler(request?: Request) {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Authentication required.' },
      { status: 401 }
    );
  }
  const userId = auth.userId;
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  try {
    const records = await listSocialAccounts(supabase, userId);
    const accounts: PublicAccountItem[] = [];
    for (const record of records) {
      let effectiveRecord = record;
      if (record.provider === 'instagram') {
        try {
          // Resyncs username/name/picture when stale or incomplete, so an
          // Instagram rename or new picture shows up without reconnecting.
          effectiveRecord = await syncInstagramProfile(supabase, userId, record);
        } catch (error) {
          logger.error('[ACCOUNT] Instagram profile sync failed, keeping the stored profile', error instanceof Error ? error.message : error, { recordId: record.id });
        }
      }
      const mapped = toPublicAccountSafe(effectiveRecord);
      if (mapped) {
        accounts.push(mapped);
      } else {
        logger.error('[ACCOUNT] Registro com provider desconhecido ignorado', undefined, { recordId: record.id, provider: record.provider });
      }
    }

    return NextResponse.json({
      authenticated: true,
      accounts,
      message: 'Accounts retrieved from Supabase',
    });
  } catch (error) {
    // Generic message for the client: internal details stay server-side only
    logger.error('[ACCOUNT] Erro ao listar contas', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Failed to list accounts.', error: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}

//---------------
// DELETE /api/account — disconnects (removes) a social account of the logged-in user.
// Query params: provider (youtube|instagram|bluesky|linkedin|threads) and providerAccountId.
// Auth = sessão Supabase (cookie) OU API key pessoal (Bearer/x-api-key, MCP),
// igual ao GET.
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
  const provider = params.get('provider');
  const providerAccountId = params.get('providerAccountId');

  if (!provider || !providerAccountId) {
    return NextResponse.json(
      { success: false, error: 'INVALID_PARAMS', message: 'provider and providerAccountId are required.' },
      { status: 400 }
    );
  }
  if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { success: false, error: 'INVALID_PROVIDER', message: 'Unknown provider.' },
      { status: 400 }
    );
  }

  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  try {
    await deleteSocialAccount(supabase, auth.userId, provider as SocialProvider, providerAccountId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[ACCOUNT] Erro ao desconectar conta', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, message: 'Failed to disconnect account.', error: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/account', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/account', deleteHandler, { getUserId: resolveReportingUserId });
