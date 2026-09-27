import { NextResponse } from 'next/server';
import { listSocialAccounts, getSocialAccountTokens, updateSocialAccountMetadata, deleteSocialAccount, type SocialAccountRecord } from '@/lib/social-accounts';
import { toPublicAccountSafe, type PublicAccountItem, SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { InstagramService } from '@/lib/instagram';
import type { SupabaseClient } from '@supabase/supabase-js';

//---------------
// instagramPictureUrlExpired — as URLs de mídia do Instagram CDN são assinadas
// e expiram (param `oe` = timestamp Unix em hex). Sem essa checagem, a foto de
// perfil salva no banco deixa de carregar após alguns dias.
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
// refreshInstagramAccountPicture — quando a foto de perfil salva expirou,
// busca o perfil na Graph API com o token da conta e atualiza o metadata.
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

  console.log('[ACCOUNT] Foto de perfil do Instagram renovada', {
    recordId: record.id,
    igUserId: record.providerAccountId,
  });

  return { ...record, accountMetadata: metadata };
}

//---------------
// GET /api/account — lista todas as contas sociais do usuário logado (SEM tokens).
// O shape por provider vem do registry (lib/providers/registry.ts); provider
// desconhecido é descartado com log no servidor (só a linha ruim some, não a lista).
// Auth = sessão Supabase (cookie) OU API key pessoal (Bearer/x-api-key, MCP).
//---------------
export async function GET(request?: Request) {
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
          console.error(
            '[ACCOUNT] Falha ao renovar foto de perfil do Instagram, seguindo com a salva',
            { recordId: record.id, error: error instanceof Error ? error.message : error }
          );
        }
      }
      const mapped = toPublicAccountSafe(effectiveRecord);
      if (mapped) {
        accounts.push(mapped);
      } else {
        console.error(
          '[ACCOUNT] Registro com provider desconhecido ignorado',
          { recordId: record.id, provider: record.provider }
        );
      }
    }

    return NextResponse.json({
      authenticated: true,
      accounts,
      message: 'Accounts retrieved from Supabase',
    });
  } catch (error) {
    // Mensagem genérica pro client: detalhes internos ficam só no servidor
    console.error('[ACCOUNT] Erro ao listar contas', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { authenticated: false, accounts: [], message: 'Failed to list accounts.', error: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}

//---------------
// DELETE /api/account — desconecta (remove) uma conta social do usuário logado.
// Query params: provider (youtube|instagram|bluesky|linkedin) e providerAccountId.
// Auth = sessão Supabase (cookie) OU API key pessoal (Bearer/x-api-key, MCP),
// igual ao GET.
//---------------

export async function DELETE(request: Request): Promise<NextResponse> {
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
    console.error('[ACCOUNT] Erro ao desconectar conta', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, message: 'Failed to disconnect account.', error: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}
