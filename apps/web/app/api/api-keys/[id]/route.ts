import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  // Same rule as POST: key management requires a full browser session.
  if (auth.isApiKey === true) {
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
