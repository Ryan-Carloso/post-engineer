import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { isValidRumbleAccessToken } from '@/lib/rumble';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; code?: string; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readCredentials(request: Request): Promise<
  | { ok: true; channelId: string; accessToken: string }
  | { ok: false; error: string }
> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' };
    }
    if (!isRecord(body)) {
      return { ok: false, error: 'Invalid JSON payload.' };
    }
    const channelId = body.channelId;
    const accessToken = body.accessToken;
    if (typeof channelId !== 'string' || !channelId.trim()) {
      return { ok: false, error: 'Rumble channel ID is required.' };
    }
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      return { ok: false, error: 'Rumble access token is required.' };
    }
    return { ok: true, channelId: channelId.trim(), accessToken: accessToken.trim() };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }
  const channelId = formData.get('channelId');
  const accessToken = formData.get('accessToken');
  if (typeof channelId !== 'string' || !channelId.trim()) {
    return { ok: false, error: 'Rumble channel ID is required.' };
  }
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    return { ok: false, error: 'Rumble access token is required.' };
  }
  return { ok: true, channelId: channelId.trim(), accessToken: accessToken.trim() };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.rumbleConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return errorResponse(401, 'Authentication required.', 'POST /api/rumble-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return errorResponse(400, credentials.error, 'POST /api/rumble-connect');
  }
  const { channelId, accessToken } = credentials;

  if (!isValidRumbleAccessToken(accessToken)) {
    return errorResponse(
      400,
      'Rumble access token must be the 40-character token issued by Rumble (email bd@rumble.com).',
      'POST /api/rumble-connect',
    );
  }

  const supabase = createSupabaseServiceClient();

  try {
    const encrypted = encryptTokens({
      access_token: accessToken,
      token_type: 'rumble_access_token',
      channel_id: channelId,
    });

    const { data: upserted, error: upsertError } = await supabase
      .from('social_accounts')
      .upsert(
        {
          user_id: auth.userId,
          provider: 'rumble',
          provider_account_id: channelId,
          account_name: channelId,
          account_metadata: {},
          encrypted_tokens: encrypted,
          needs_reconnect: false,
        },
        { onConflict: 'user_id,provider,provider_account_id' },
      )
      .select('id')
      .single();

    if (upsertError || !upserted) {
      return errorResponse(500, 'Could not save the Rumble account.', 'POST /api/rumble-connect', {
        cause: upsertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: upserted.id, channelId });
  } catch (error) {
    return errorResponse(500, 'Could not connect the Rumble account.', 'POST /api/rumble-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: 'Rumble connection failed.',
    });
  }
}

export const POST = withApiErrorReporting('POST /api/rumble-connect', postHandler, { getUserId: resolveReportingUserId });
