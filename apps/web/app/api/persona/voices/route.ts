import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// GET /api/persona/voices — proxy of the house voice catalog to
// money-print. Single source of truth: the ids used in samples and in
// video jobs are always money-print's.
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
//---------------

function moneyPrintBaseUrl(): string {
  const url = process.env.MONEYPRINT_API_URL;
  if (!url) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  return url.replace(/\/+$/, '');
}

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let baseUrl: string;
  try {
    baseUrl = moneyPrintBaseUrl();
  } catch (error) {
    logger.error('[api/persona/voices] env missing', error);
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
      logger.error('[api/persona/voices] money-print error', undefined, { status: upstream.status });
      return NextResponse.json(
        { success: false, error: 'Voices unavailable.' },
        { status: 502 },
      );
    }

    // The engine wraps payloads in its BaseResponse envelope
    // ({ status, message, body }); the catalog lives under `body`.
    const envelope: { body?: unknown } = await upstream.json();
    const data = envelope.body;
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
    logger.error('[api/persona/voices] money-print unreachable', error);
    return NextResponse.json(
      { success: false, error: 'Voices service unreachable.' },
      { status: 502 },
    );
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/voices', getHandler);
