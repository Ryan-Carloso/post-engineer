import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const START_TIME = Date.now();

async function getHandler() {
  const { auth, error: authError } = await requireSupabaseSession();
  if (authError || !auth) return authError;

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
