import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { isValidRumbleAccessToken } from '@/lib/rumble';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// POST /api/rumble-connect — connects a Rumble channel with its manually
// issued Simple Upload API access token.
//
// Rumble has no OAuth and no read API, so there is nothing to validate
// the token against short of uploading a video: the route checks only
// the token's shape (40 hex chars) and the channel id, then encrypts
// and stores them (provider='rumble', provider_account_id=channel id).
// A wrong token surfaces at first publish as an invalid_token error and
// is reported for reconnecting (see lib/upload/rumble-handler.ts).
//
// Two entry flows (same business logic):
// - Web: Supabase session + FormData { channelId, accessToken } (original).
// - MCP: Post Engineer API key + JSON { channelId, accessToken }.
//
// The "API key" here is Post Engineer's — it only identifies WHICH user
// is connecting. The Rumble credential remains the channel id + access
// token in the body (Rumble has no API keys of its own beyond the token);
// the token is validated for shape before saving, never logged.
//---------------

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
    // A JSON `null` (or array) parses fine but is not an object: reading
    // fields off it would throw a TypeError instead of returning the 400.
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

  // The token cannot be validated against Rumble without uploading, so
  // the shape check is the whole validation: 40 hex chars, issued by
  // emailing bd@rumble.com. A mistyped token fails loudly here instead
  // of being stored and failing every publish.
  if (!isValidRumbleAccessToken(accessToken)) {
    return errorResponse(
      400,
      'Rumble access token must be the 40-character token issued by Rumble (email bd@rumble.com).',
      'POST /api/rumble-connect',
    );
  }

  const supabase =
    auth.isApiKey === true ? createSupabaseServiceClient() : await createSupabaseServerClient();

  try {
    const encrypted = encryptTokens({
      access_token: accessToken,
      token_type: 'rumble_access_token',
      channel_id: channelId,
    });

    // Upsert, not insert: a reconnect refreshes the token on the row the
    // unique (user_id, provider, provider_account_id) key already holds
    // (migration 040), so a plain insert fails with a constraint violation.
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
        },
        { onConflict: 'user_id,provider,provider_account_id' },
      )
      .select('id')
      .single();

    if (upsertError || !upserted) {
      // The full PostgREST error object (not just the message) is threaded
      // as cause so the PostHog issue carries code/details/hint.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/rumble-connect', postHandler, { getUserId: resolveReportingUserId });
