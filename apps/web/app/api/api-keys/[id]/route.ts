import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { ApprovalMode } from '@/lib/api-keys';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isUuid, parseApprovalMode, parsePersonaScope, rejectUnownedPersonas, serializeKey } from '../key-input';

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

async function patchHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.apiKeyManage, auth.userId);
  if (limited) return limited;

  if (auth.isApiKey === true || auth.isOAuth === true) {
    return NextResponse.json(
      { success: false, error: 'API keys cannot edit API keys. Sign in to edit keys.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (typeof id !== 'string' || !isUuid(id)) {
    return apiErrorResponse(400, 'Invalid key ID.', { route: 'PATCH /api/api-keys/[id]' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body must be valid JSON.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: 'Body must be a JSON object.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;

  const changes: { approval_mode?: ApprovalMode; persona_ids?: string[] | null } = {};
  if (input.approvalMode !== undefined) {
    const mode = parseApprovalMode(input.approvalMode);
    if (!mode.ok) return NextResponse.json({ success: false, error: mode.error }, { status: 400 });
    changes.approval_mode = mode.value;
  }
  if (input.personaIds !== undefined) {
    const scope = parsePersonaScope(input.personaIds);
    if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: 400 });
    changes.persona_ids = scope.value;
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json(
      { success: false, error: 'Send approvalMode and/or personaIds to change.' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServiceClient();

  const { data: existing, error: lookupError } = await supabase
    .from('user_api_keys')
    .select('id, revoked_at')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (lookupError) {
    logger.error('[api/api-keys] update lookup failed', lookupError);
    return NextResponse.json({ success: false, error: 'Failed to update API key.' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ success: false, error: 'API key not found.' }, { status: 404 });
  }
  if (existing.revoked_at !== null) {
    return NextResponse.json({ success: false, error: 'API key is revoked.' }, { status: 409 });
  }

  if (changes.persona_ids !== undefined && changes.persona_ids !== null) {
    const rejection = await rejectUnownedPersonas(supabase, auth.userId, changes.persona_ids);
    if (rejection) return rejection;
  }

  const { data: updated, error: updateError } = await supabase
    .from('user_api_keys')
    .update(changes)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .select('id, name, key_prefix, persona_ids, approval_mode, created_at, last_used_at, revoked_at')
    .maybeSingle();
  if (updateError) {
    logger.error('[api/api-keys] update failed', updateError);
    return NextResponse.json({ success: false, error: 'Failed to update API key.' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ success: false, error: 'API key is revoked.' }, { status: 409 });
  }

  return NextResponse.json({ success: true, key: serializeKey(updated) });
}

export const PATCH = withApiErrorReporting('PATCH /api/api-keys/[id]', patchHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/api-keys/[id]', deleteHandler, { getUserId: resolveReportingUserId });
