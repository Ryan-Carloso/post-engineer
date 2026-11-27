import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { isValidRumbleAccessToken } from '@/lib/rumble';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { routeErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { isFilled, readConnectFields } from '@/lib/connect-fields';

async function readCredentials(request: Request): Promise<
  | { ok: true; channelId: string; accessToken: string }
  | { ok: false; error: string }
> {
  const read = await readConnectFields(request, ['channelId', 'accessToken']);
  if (!read.ok) return read;
  const { channelId, accessToken } = read.fields;
  if (!isFilled(channelId)) return { ok: false, error: 'Rumble channel ID is required.' };
  if (!isFilled(accessToken)) return { ok: false, error: 'Rumble access token is required.' };
  return { ok: true, channelId: channelId.trim(), accessToken: accessToken.trim() };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.rumbleConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return routeErrorResponse(401, 'Authentication required.', 'POST /api/rumble-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return routeErrorResponse(400, credentials.error, 'POST /api/rumble-connect');
  }
  const { channelId, accessToken } = credentials;

  if (!isValidRumbleAccessToken(accessToken)) {
    return routeErrorResponse(
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
      return routeErrorResponse(500, 'Could not save the Rumble account.', 'POST /api/rumble-connect', {
        cause: upsertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: upserted.id, channelId });
  } catch (error) {
    return routeErrorResponse(500, 'Could not connect the Rumble account.', 'POST /api/rumble-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: 'Rumble connection failed.',
    });
  }
}

export const POST = withApiErrorReporting('POST /api/rumble-connect', postHandler, { getUserId: resolveReportingUserId });
