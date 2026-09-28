import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/voice-sample-languages — proxy da lista de idiomas
// disponíveis para amostras de voz no money-print.
//---------------

function moneyPrintBaseUrl(): string {
  const url = process.env.MONEYPRINT_API_URL;
  if (!url) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  return url.replace(/\/+$/, '');
}

export async function GET(): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;

  let baseUrl: string;
  try {
    baseUrl = moneyPrintBaseUrl();
  } catch (error) {
    logger.error('[api/persona/voice-sample-languages] env missing', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Configuration error.' },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/personas/voices/sample-languages`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      logger.error('[api/persona/voice-sample-languages] money-print error', undefined, {
        status: upstream.status,
      });
      return NextResponse.json(
        { success: false, error: 'Sample languages unavailable.' },
        { status: 502 },
      );
    }

    const body: { data?: unknown } = await upstream.json();
    const data = body.data;
    if (
      !Array.isArray(data) ||
      !data.every(
        (item): item is { code: string; label: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { code?: unknown }).code === 'string' &&
          typeof (item as { label?: unknown }).label === 'string',
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid sample languages payload.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ languages: data });
  } catch (error) {
    logger.error('[api/persona/voice-sample-languages] money-print unreachable', error);
    return NextResponse.json(
      { success: false, error: 'Sample languages service unreachable.' },
      { status: 502 },
    );
  }
}
