import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { BlueskyError, loginToBluesky } from '@/lib/bluesky';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';

//---------------
// POST /api/bluesky-connect — connects a Bluesky account via app password.
// Validates the credential against Bluesky BEFORE saving, encrypts the password
// (equivalent to the account password) and inserts into social_accounts with
// provider='bluesky' and provider_account_id=did.
//
// Two entry flows (same business logic):
// - Web: Supabase session + FormData { handle, appPassword } (original).
// - MCP: Post Engineer API key + JSON { handle, appPassword }.
//
// The "API key" here is Post Engineer's — it only identifies WHICH user
// is connecting. The Bluesky credential remains handle + app password in
// the body (Bluesky has no API keys); the password is validated against
// Bluesky's servers before saving.
//---------------

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

async function readCredentials(request: Request): Promise<
  | { ok: true; handle: string; appPassword: string }
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
    const handle = (body as Record<string, unknown>).handle;
    const appPassword = (body as Record<string, unknown>).appPassword;
    if (typeof handle !== 'string' || !handle.trim()) {
      return { ok: false, error: 'Bluesky handle is required.' };
    }
    if (typeof appPassword !== 'string' || !appPassword.trim()) {
      return { ok: false, error: 'Bluesky app password is required.' };
    }
    return { ok: true, handle: handle.trim(), appPassword };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }
  const handle = formData.get('handle');
  const appPassword = formData.get('appPassword');
  if (typeof handle !== 'string' || !handle.trim()) {
    return { ok: false, error: 'Bluesky handle is required.' };
  }
  if (typeof appPassword !== 'string' || !appPassword.trim()) {
    return { ok: false, error: 'Bluesky app password is required.' };
  }
  return { ok: true, handle: handle.trim(), appPassword };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.blueskyConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return errorResponse(401, 'Authentication required.', 'POST /api/bluesky-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return errorResponse(400, credentials.error, 'POST /api/bluesky-connect');
  }
  const { handle, appPassword } = credentials;

  const supabase =
    auth.isApiKey === true ? createSupabaseServiceClient() : await createSupabaseServerClient();

  try {
    const { did, handle: resolvedHandle } = await loginToBluesky(handle, appPassword);

    const encrypted = encryptTokens({
      access_token: appPassword,
      token_type: 'bluesky_app_password',
      handle: resolvedHandle,
      did,
    });

    const { data: inserted, error: insertError } = await supabase
      .from('social_accounts')
      .insert({
        user_id: auth.userId,
        provider: 'bluesky',
        provider_account_id: did,
        account_name: resolvedHandle,
        encrypted_tokens: encrypted,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      // The full PostgREST error object (not just the message) is threaded
      // as cause so the PostHog issue carries code/details/hint.
      return errorResponse(500, 'Could not save the Bluesky account.', 'POST /api/bluesky-connect', {
        cause: insertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: inserted.id, did });
  } catch (error) {
    const isInvalidCredentials =
      (error instanceof BlueskyError && error.code === 'invalid_credentials') ||
      (error instanceof Error && error.name === 'BlueskyError' && /Invalid Bluesky/i.test(error.message));
    if (isInvalidCredentials) {
      return errorResponse(401, 'Invalid Bluesky handle or app password.', 'POST /api/bluesky-connect');
    }
    return errorResponse(500, 'Could not connect the Bluesky account.', 'POST /api/bluesky-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: 'Bluesky connection failed.',
    });
  }
}
