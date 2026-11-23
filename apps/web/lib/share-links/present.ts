export interface ShareLinkView {
  id: string;
  personaIds: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastViewedAt: string | null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
}

export function presentShareLink(raw: unknown): ShareLinkView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.created_at !== 'string') return null;
  const expiresAt = nullableString(row.expires_at);
  const revokedAt = nullableString(row.revoked_at);
  const lastViewedAt = nullableString(row.last_viewed_at);
  if (expiresAt === undefined || revokedAt === undefined || lastViewedAt === undefined) return null;
  const personaIds = Array.isArray(row.persona_ids)
    ? row.persona_ids.filter((id): id is string => typeof id === 'string')
    : null;
  return { id: row.id, personaIds, createdAt: row.created_at, expiresAt, revokedAt, lastViewedAt };
}
