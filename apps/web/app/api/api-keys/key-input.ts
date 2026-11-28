import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isApprovalMode, type ApprovalMode } from '@/lib/api-keys';
import { logger } from '@/lib/logger';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function parseApprovalMode(value: unknown): ParseResult<ApprovalMode> {
  if (isApprovalMode(value)) return { ok: true, value };
  return { ok: false, error: 'approvalMode must be "yolo" or "approval".' };
}

export function parsePersonaScope(value: unknown): ParseResult<string[] | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, error: 'personaIds must be an array of persona IDs.' };
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && isUuid(item)))];
  if (ids.length !== value.length) {
    return { ok: false, error: 'personaIds must contain only valid persona IDs.' };
  }
  if (ids.length === 0) {
    return { ok: false, error: 'Select at least one persona or leave the key unrestricted.' };
  }
  return { ok: true, value: ids };
}

export async function rejectUnownedPersonas(
  supabase: SupabaseClient,
  userId: string,
  personaIds: string[],
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('personas')
    .select('id')
    .eq('user_id', userId)
    .in('id', personaIds);
  if (error) {
    logger.error('[api/api-keys] persona ownership check failed', error);
    return NextResponse.json({ success: false, error: 'Failed to verify personas.' }, { status: 500 });
  }
  const ownedIds = new Set((data ?? []).map((p) => p.id as string));
  if (personaIds.some((id) => !ownedIds.has(id))) {
    return NextResponse.json(
      { success: false, error: 'personaIds must reference only your own personas.' },
      { status: 400 },
    );
  }
  return null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  persona_ids: unknown;
  approval_mode: unknown;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function serializeKey(row: ApiKeyRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    personaIds: Array.isArray(row.persona_ids) ? row.persona_ids : null,
    approvalMode: isApprovalMode(row.approval_mode) ? row.approval_mode : 'approval',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
