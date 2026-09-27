import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { toFiniteNumber } from '@/lib/tokens';

//---------------
// GET /api/billing/tokens — authoritative prepaid wallet balance.
// Garante o bônus único de 3 tokens grátis (lazy grant) e retorna
// o total mais o breakdown free (a UI só exibe badge free se > 0).
// Auth = sessão Supabase (cookie) OU API key pessoal (Bearer/x-api-key, MCP).
//---------------

export async function GET(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const userId = auth.userId;
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  // Bônus de boas-vindas (idempotente, best-effort).
  try {
    const { error: grantError } = await createSupabaseServiceClient().rpc('grant_signup_bonus', {
      p_user_id: userId,
    });
    if (grantError) {
      console.error('[api/billing/tokens] signup bonus grant failed', { userId, error: grantError });
    }
  } catch (grantException) {
    console.error('[api/billing/tokens] signup bonus grant threw', { userId, error: grantException });
  }

  // Busca o profile (pode não existir para usuários free sem billing)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tokens_balance, free_tokens_balance')
    .eq('id', userId)
    .single();

  // Se não tem profile, é free com 0 tokens.
  // numeric do Postgres chega como string via PostgREST — coagir para number.
  const paid = toFiniteNumber((profile as { tokens_balance?: unknown } | null)?.tokens_balance, 0);
  const free = toFiniteNumber((profile as { free_tokens_balance?: unknown } | null)?.free_tokens_balance, 0);

  return NextResponse.json({
    success: true,
    balance: paid + free,
    free,
  });
}
