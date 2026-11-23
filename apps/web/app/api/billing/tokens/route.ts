import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { toFiniteNumber } from '@/lib/tokens';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId, attachApiErrorProperties } from '@/lib/api-error-reporting';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller } from '@/lib/rate-limit';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.billingTokens), auth.userId);
  if (limited) return limited;
  const userId = auth.userId;
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tokens_balance, free_tokens_balance')
    .eq('id', userId)
    .single();

  const paid = toFiniteNumber((profile as { tokens_balance?: unknown } | null)?.tokens_balance, 0);
  const free = toFiniteNumber((profile as { free_tokens_balance?: unknown } | null)?.free_tokens_balance, 0);

  const balance = paid + free;
  const response = NextResponse.json({
    success: true,
    balance,
    free,
  });
  attachApiErrorProperties(response, { balance });
  return response;
}

export const GET = withApiErrorReporting('GET /api/billing/tokens', getHandler, { getUserId: resolveReportingUserId });
