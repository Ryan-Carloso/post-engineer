import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { generateRawApiKey, hashApiKey, extractKeyPrefix } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

interface CreateKeyBody {
  name?: unknown;
  personaIds?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePersonaScope(value: unknown): { ok: true; personaIds: string[] | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, personaIds: null };
  if (!Array.isArray(value)) return { ok: false, error: 'personaIds must be an array of persona IDs.' };
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && UUID_PATTERN.test(item)))];
  if (ids.length !== value.length) {
    return { ok: false, error: 'personaIds must contain only valid persona IDs.' };
  }
  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one persona or leave the key unrestricted.' };
  }
  return { ok: true, personaIds: ids };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('id, name, key_prefix, persona_ids, created_at, last_used_at, revoked_at')
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
    keys: (data ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      personaIds: Array.isArray(k.persona_ids) ? k.persona_ids : null,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.apiKeyManage);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  // Key management requires a full browser session. Any API-key-authenticated
  // request is rejected here — an unrestricted key could otherwise mint new
  // keys or revoke the keys that control it (self-escalation / lockout).
  if (auth.isApiKey === true) {
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

  const supabase = createSupabaseServiceClient();

  // Scope may only reference the user's own personas.
  if (scope.personaIds !== null) {
    const { data: owned, error: ownedError } = await supabase
      .from('personas')
      .select('id')
      .eq('user_id', auth.userId)
      .in('id', scope.personaIds);
    const ownedIds = new Set((owned ?? []).map((p) => p.id as string));
    if (ownedError || scope.personaIds.some((id) => !ownedIds.has(id))) {
      return NextResponse.json(
        { success: false, error: 'personaIds must reference only your own personas.' },
        { status: 400 },
      );
    }
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
      persona_ids: scope.personaIds,
    })
    .select('id, name, key_prefix, persona_ids, created_at')
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
      createdAt: data.created_at,
    },
    { status: 201 },
  );
}
