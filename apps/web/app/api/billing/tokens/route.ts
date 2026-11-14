import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { toFiniteNumber } from '@/lib/tokens';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId, attachApiErrorProperties } from '@/lib/api-error-reporting';

//---------------
// GET /api/billing/tokens — authoritative prepaid wallet balance.
// Grants the one-time 3 free tokens bonus (lazy grant) and returns
// the total plus the free breakdown (the UI only shows the free badge when > 0).
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
//---------------

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const userId = auth.userId;
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  // Welcome bonus (idempotent, best-effort).
  try {
    const { error: grantError } = await createSupabaseServiceClient().rpc('grant_signup_bonus', {
      p_user_id: userId,
    });
    if (grantError) {
      logger.error('[api/billing/tokens] signup bonus grant failed', grantError, { userId });
    }
  } catch (grantException) {
    logger.error('[api/billing/tokens] signup bonus grant threw', grantException, { userId });
  }

  // Fetch the profile (may not exist for free users without billing)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tokens_balance, free_tokens_balance')
    .eq('id', userId)
    .single();

  // No profile means free with 0 tokens.
  // Postgres numeric arrives as a string via PostgREST — coerce to number.
  const paid = toFiniteNumber((profile as { tokens_balance?: unknown } | null)?.tokens_balance, 0);
  const free = toFiniteNumber((profile as { free_tokens_balance?: unknown } | null)?.free_tokens_balance, 0);

  const balance = paid + free;
  const response = NextResponse.json({
    success: true,
    balance,
    free,
  });
  // The wrapper never reads the body, so attach the balance for the
  // token_balance_fetched event — without it the balance was invisible in
  // PostHog (route + status only) and a jump could not be traced to the
  // value the user actually saw.
  attachApiErrorProperties(response, { balance });
  return response;
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/billing/tokens', getHandler, { getUserId: resolveReportingUserId });
