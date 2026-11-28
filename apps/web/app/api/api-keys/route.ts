import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { generateRawApiKey, hashApiKey, extractKeyPrefix, isApprovalMode } from '@/lib/api-keys';
import { parseApprovalMode, parsePersonaScope, rejectUnownedPersonas, serializeKey } from './key-input';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

interface CreateKeyBody {
  name?: unknown;
  personaIds?: unknown;
  approvalMode?: unknown;
}

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.apiKeyList, auth.userId);
  if (limited) return limited;

  if (auth.isApiKey === true || auth.isOAuth === true) {
    return NextResponse.json(
      { success: false, error: 'API keys cannot manage API keys. Sign in to manage keys.' },
      { status: 403 },
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('id, name, key_prefix, persona_ids, approval_mode, created_at, last_used_at, revoked_at')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[api/api-keys] list failed', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list API keys.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    keys: (data ?? []).map(serializeKey),
  });
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.apiKeyManage);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  if (auth.isApiKey === true || auth.isOAuth === true) {
    return NextResponse.json(
      { success: false, error: 'API keys cannot manage API keys. Sign in to manage keys.' },
      { status: 403 },
    );
  }

  let body: CreateKeyBody = {};
  try {
    body = (await request.json()) as CreateKeyBody;
  } catch {
    body = {};
  }

  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim().slice(0, 64)
      : 'Default API Key';

  const scope = parsePersonaScope(body.personaIds);
  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: 400 },
    );
  }

  const mode =
    body.approvalMode === undefined || body.approvalMode === null
      ? ({ ok: true, value: 'approval' } as const)
      : parseApprovalMode(body.approvalMode);
  if (!mode.ok) {
    return NextResponse.json(
      { success: false, error: mode.error },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServiceClient();

  if (scope.value !== null) {
    const rejection = await rejectUnownedPersonas(supabase, auth.userId, scope.value);
    if (rejection) return rejection;
  }

  const rawKey = generateRawApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = extractKeyPrefix(rawKey);

  const { data, error } = await supabase
    .from('user_api_keys')
    .insert({
      user_id: auth.userId,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      persona_ids: scope.value,
      approval_mode: mode.value,
    })
    .select('id, name, key_prefix, persona_ids, approval_mode, created_at')
    .single();

  if (error || !data) {
    logger.error('[api/api-keys] create failed', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create API key.' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      key: rawKey,
      id: data.id,
      name: data.name,
      keyPrefix: data.key_prefix,
      personaIds: Array.isArray(data.persona_ids) ? data.persona_ids : null,
      approvalMode: isApprovalMode(data.approval_mode) ? data.approval_mode : 'approval',
      createdAt: data.created_at,
    },
    { status: 201 },
  );
}

export const GET = withApiErrorReporting('GET /api/api-keys', getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting('POST /api/api-keys', postHandler, { getUserId: resolveReportingUserId });
