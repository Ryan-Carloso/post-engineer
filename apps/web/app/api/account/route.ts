import { NextResponse } from 'next/server';
import { listSocialAccounts, getSocialAccountTokens, updateSocialAccountMetadata, deleteSocialAccount, type SocialAccountRecord } from '@/lib/social-accounts';
import { toPublicAccountSafe, type PublicAccountItem, SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { InstagramService } from '@/lib/instagram';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// instagramPictureUrlExpired — Instagram CDN media URLs are signed
// and expire (param `oe` = Unix timestamp in hex). Without this check,
// the profile photo saved in the database stops loading after a few days.
//---------------
function instagramPictureUrlExpired(url: string): boolean {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (!oe) return false;
    const expiresAtMs = Number.parseInt(oe, 16) * 1000;
    return Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
  } catch {
    return false;
  }
}

//---------------
// refreshInstagramAccountPicture — when the saved profile photo expired,
// fetch the profile from the Graph API with the account token and update
// the metadata.
// Best-effort: quem chama trata falha (ex.: token revogado) e segue com o
// registro original.
//---------------
async function refreshInstagramAccountPicture(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord
): Promise<SocialAccountRecord> {
  const savedPictureUrl = record.accountMetadata.profilePictureUrl;
  if (typeof savedPictureUrl !== 'string' || !instagramPictureUrlExpired(savedPictureUrl)) {
    return record;
  }

  const { tokens } = await getSocialAccountTokens(
    supabase,
    userId,
    'instagram',
    record.providerAccountId
  );

  const service = new InstagramService();
  const profile = await service.getProfile(String(tokens.access_token));
  if (!profile.profilePictureUrl) {
    return record;
  }

  const metadata: Record<string, unknown> = {
    ...record.accountMetadata,
    profilePictureUrl: profile.profilePictureUrl,
  };
  if (profile.name !== undefined) metadata.name = profile.name;
  if (profile.followersCount !== undefined) metadata.followersCount = profile.followersCount;
  if (profile.mediaCount !== undefined) metadata.mediaCount = profile.mediaCount;

  await updateSocialAccountMetadata(
    supabase,
    userId,
    'instagram',
    record.providerAccountId,
    metadata
  );

  logger.info('[ACCOUNT] Foto de perfil do Instagram renovada', {
    recordId: record.id,
    igUserId: record.providerAccountId,
  });

  return { ...record, accountMetadata: metadata };
}

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
          effectiveRecord = await refreshInstagramAccountPicture(supabase, userId, record);
        } catch (error) {
          logger.error('[ACCOUNT] Falha ao renovar foto de perfil do Instagram, seguindo com a salva', error instanceof Error ? error.message : error, { recordId: record.id });
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
// Query params: provider (youtube|instagram|bluesky|linkedin) and providerAccountId.
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
