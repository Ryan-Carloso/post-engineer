import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// Health Check — verifica apenas se o Supabase está acessível.
// API interna: exige sessão Supabase (usuário logado no app).
//---------------

const START_TIME = Date.now();

export async function GET() {
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('social_accounts')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      status: error ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
