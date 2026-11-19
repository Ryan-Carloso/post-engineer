import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { ThreespeakError, loginToThreespeak } from '@/lib/threespeak';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

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

  const supabase = createSupabaseServiceClient();

  try {
    const { username: normalizedUsername } = await loginToThreespeak(username, postingKey);

    const encrypted = encryptTokens({
      access_token: postingKey,
      token_type: 'threespeak_posting_key',
      handle: normalizedUsername,
    });

    const { data: upserted, error: upsertError } = await supabase
      .from('social_accounts')
      .upsert(
        {
          user_id: auth.userId,
          provider: '3speak',
          provider_account_id: normalizedUsername,
          account_name: normalizedUsername,
          account_metadata: {},
          encrypted_tokens: encrypted,
          needs_reconnect: false,
        },
        { onConflict: 'user_id,provider,provider_account_id' },
      )
      .select('id')
      .single();

    if (upsertError || !upserted) {
      return errorResponse(500, 'Could not save the 3Speak account.', 'POST /api/threespeak-connect', {
        cause: upsertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({ success: true, accountId: upserted.id, username: normalizedUsername });
  } catch (error) {
    const isInvalidCredentials =
      (error instanceof ThreespeakError && error.code === 'invalid_credentials') ||
      (error instanceof Error && error.name === 'ThreespeakError' && /Invalid Hive/i.test(error.message));
    if (isInvalidCredentials) {
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

export const POST = withApiErrorReporting('POST /api/threespeak-connect', postHandler, { getUserId: resolveReportingUserId });
