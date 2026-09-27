import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

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
    return NextResponse.json({ success: false, error: 'Invalid key ID.' }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from('user_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.userId);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to revoke API key.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
