import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { ThreespeakError, loginToThreespeak } from '@/lib/threespeak';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// POST /api/threespeak-connect — connects a 3Speak (Hive) account via
// posting key. Validates the credential against 3Speak Studio BEFORE
// saving (the login mints a JWT with the key), encrypts the posting key
// (like the Bluesky app password) and inserts into social_accounts with
// provider='3speak' and provider_account_id=<hive username>.
//
// Two entry flows (same business logic):
// - Web: Supabase session + FormData { username, postingKey } (original).
// - MCP: Post Engineer API key + JSON { username, postingKey }.
//
// The "API key" here is Post Engineer's — it only identifies WHICH user
// is connecting. The Hive credential remains username + posting key in
// the body (3Speak has no OAuth and no API keys of its own); the key is
// validated against Studio's servers before saving. Only the POSTING key
// is accepted — never the owner/active key or the master password —
// because posting is all the integration needs, and the posting key
// cannot move funds.
//---------------

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; code?: string; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

async function readCredentials(request: Request): Promise<
  | { ok: true; username: string; postingKey: string }
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
    const username = (body as Record<string, unknown>).username;
    const postingKey = (body as Record<string, unknown>).postingKey;
    if (typeof username !== 'string' || !username.trim()) {
      return { ok: false, error: 'Hive username is required.' };
    }
    if (typeof postingKey !== 'string' || !postingKey.trim()) {
      return { ok: false, error: 'Hive posting key is required.' };
    }
    return { ok: true, username: username.trim(), postingKey };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }
  const username = formData.get('username');
  const postingKey = formData.get('postingKey');
  if (typeof username !== 'string' || !username.trim()) {
    return { ok: false, error: 'Hive username is required.' };
  }
  if (typeof postingKey !== 'string' || !postingKey.trim()) {
    return { ok: false, error: 'Hive posting key is required.' };
  }
  return { ok: true, username: username.trim(), postingKey };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.threespeakConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return errorResponse(401, 'Authentication required.', 'POST /api/threespeak-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return errorResponse(400, credentials.error, 'POST /api/threespeak-connect');
  }
  const { username, postingKey } = credentials;

  const supabase =
    auth.isApiKey === true ? createSupabaseServiceClient() : await createSupabaseServerClient();

  try {
    const { username: normalizedUsername } = await loginToThreespeak(username, postingKey);

    const encrypted = encryptTokens({
      access_token: postingKey,
      token_type: 'threespeak_posting_key',
      handle: normalizedUsername,
    });

    const { data: inserted, error: insertError } = await supabase
      .from('social_accounts')
      .insert({
        user_id: auth.userId,
        provider: '3speak',
        provider_account_id: normalizedUsername,
        account_name: normalizedUsername,
        account_metadata: {},
        encrypted_tokens: encrypted,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      // The full PostgREST error object (not just the message) is threaded
      // as cause so the PostHog issue carries code/details/hint.
      return errorResponse(500, 'Could not save the 3Speak account.', 'POST /api/threespeak-connect', {
        cause: insertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: inserted.id, username: normalizedUsername });
  } catch (error) {
    const isInvalidCredentials =
      (error instanceof ThreespeakError && error.code === 'invalid_credentials') ||
      (error instanceof Error && error.name === 'ThreespeakError' && /Invalid Hive/i.test(error.message));
    if (isInvalidCredentials) {
      // 422, not 401: 3Speak rejected the credential, the hub session is fine.
      // 401 stays reserved for a missing/expired hub session so clients can
      // react to every 401 as a session expiry.
      return errorResponse(422, errorMessage(ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED), 'POST /api/threespeak-connect', {
        code: ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED,
      });
    }
    return errorResponse(500, 'Could not connect the 3Speak account.', 'POST /api/threespeak-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: '3Speak connection failed.',
    });
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/threespeak-connect', postHandler, { getUserId: resolveReportingUserId });
