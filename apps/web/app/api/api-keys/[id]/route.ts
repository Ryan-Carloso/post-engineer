import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

async function deleteHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.apiKeyManage, auth.userId);
  if (limited) return limited;

  if (auth.isApiKey === true || auth.isOAuth === true) {
    return NextResponse.json(
      { success: false, error: 'API keys cannot manage API keys. Sign in to manage keys.' },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!id || typeof id !== 'string') {
    return apiErrorResponse(400, 'Invalid key ID.', { route: 'DELETE /api/api-keys/[id]' });
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from('user_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId);

  if (error) {
    logger.error('[api/api-keys] revoke failed', error);
    return NextResponse.json(
      { success: false, error: 'Failed to revoke API key.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

export const DELETE = withApiErrorReporting('DELETE /api/api-keys/[id]', deleteHandler, { getUserId: resolveReportingUserId });
