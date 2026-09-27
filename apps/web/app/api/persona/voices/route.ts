import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

//---------------
// GET /api/persona/voices — proxy do catálogo de vozes da casa para o
// money-print. Fonte única de verdade: os ids usados nos samples e nos
// jobs de vídeo são sempre os do money-print.
// Auth = sessão Supabase (cookie) OU API key pessoal (Bearer/x-api-key, MCP).
//---------------

function moneyPrintBaseUrl(): string {
  const url = process.env.MONEYPRINT_API_URL;
  if (!url) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  return url.replace(/\/+$/, '');
}

export async function GET(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let baseUrl: string;
  try {
    baseUrl = moneyPrintBaseUrl();
  } catch (error) {
    console.error('[api/persona/voices] env missing', { error });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Configuration error.' },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/personas/voices`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      console.error('[api/persona/voices] money-print error', { status: upstream.status });
      return NextResponse.json(
        { success: false, error: 'Voices unavailable.' },
        { status: 502 },
      );
    }

    const body: { data?: unknown } = await upstream.json();
    const data = body.data;
    if (
      !Array.isArray(data) ||
      !data.every(
        (item): item is { id: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { id?: unknown }).id === 'string',
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid voices payload.' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      voices: data.map(({ id }) => ({ id })),
    });
  } catch (error) {
    console.error('[api/persona/voices] money-print unreachable', { error });
    return NextResponse.json(
      { success: false, error: 'Voices service unreachable.' },
      { status: 502 },
    );
  }
}
