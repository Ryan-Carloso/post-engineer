import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const START_TIME = Date.now();

async function getHandler(request: Request) {
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.healthProbe, auth.userId);
  if (limited) return limited;

  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('social_accounts')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      status: error ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    });
  } catch (error) {
    logger.error('[api/health] health check failed', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

export const GET = withApiErrorReporting('GET /api/health', getHandler, { getUserId: resolveReportingUserId });
