import { NextResponse } from 'next/server';

import { engineBaseUrl, parseEngineJson } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

import { narrowClonedVoiceRow } from '@/lib/cloned-voices-types';

type RouteContext = { params: Promise<{ cloneId: string }> };

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }
  const { cloneId } = await context.params;
  if (!cloneId.trim()) {
    return NextResponse.json({ success: false, error: 'Clone id is required.' }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices/:id] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices/${encodeURIComponent(cloneId)}`, {
      headers: engineAuthHeaders(auth.userId),
      cache: 'no-store',
    });
    const payload = await parseEngineJson(upstream);
    if (upstream.status === 404) {
      return NextResponse.json({ success: false, error: 'Cloned voice not found.' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: 'Cloned voice unavailable.' }, { status: 502 });
    }
    const body =
      typeof payload === 'object' && payload !== null && 'body' in payload
        ? (payload as { body?: unknown }).body
        : null;
    const row = narrowClonedVoiceRow(body);
    if (row === null) {
      return NextResponse.json({ success: false, error: 'Invalid clone response.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, voice: row });
  } catch (error) {
    logger.error('[api/persona/cloned-voices/:id] get unreachable', error);
    return NextResponse.json({ success: false, error: 'Cloned voices service unreachable.' }, { status: 502 });
  }
}

async function deleteHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }
  const { cloneId } = await context.params;
  if (!cloneId.trim()) {
    return NextResponse.json({ success: false, error: 'Clone id is required.' }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices/:id] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices/${encodeURIComponent(cloneId)}`, {
      method: 'DELETE',
      headers: engineAuthHeaders(auth.userId),
    });
    if (upstream.status === 404) {
      return NextResponse.json({ success: false, error: 'Cloned voice not found.' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: 'Could not delete cloned voice.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[api/persona/cloned-voices/:id] delete unreachable', error);
    return NextResponse.json({ success: false, error: 'Cloned voices service unreachable.' }, { status: 502 });
  }
}

const GET_ROUTE = 'GET /api/persona/cloned-voices/[cloneId]';
const DELETE_ROUTE = 'DELETE /api/persona/cloned-voices/[cloneId]';

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, {
  getUserId: resolveReportingUserId,
});

export const DELETE = withApiErrorReporting(DELETE_ROUTE, deleteHandler, {
  getUserId: resolveReportingUserId,
});
