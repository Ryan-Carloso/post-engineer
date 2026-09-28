import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

//---------------
// GET /api/moneyprint/health — diagnóstico do proxy até o motor.
// API interna: exige sessão Supabase. Mantém a URL do backend apenas
// no servidor e retorna status sanitizado.
//---------------

export async function GET(): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { status: 'not_configured', error: 'MONEYPRINT_API_URL is not defined' },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`, {
      cache: 'no-store',
    });
    return NextResponse.json(
      { status: response.ok ? 'ok' : 'error', upstreamStatus: response.status },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    logger.error('[api/moneyprint/health] upstream unavailable', error);
    return NextResponse.json(
      { status: 'unavailable', error: 'Money-print is unreachable' },
      { status: 502 },
    );
  }
}
