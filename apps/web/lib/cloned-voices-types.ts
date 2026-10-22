export interface ClonedVoicePublicRow {
  id: string;
  status: string;
  language: string | null;
  name: string | null;
  voice_id: string | null;
  error_code: string | null;
  consent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function narrowClonedVoiceRow(value: unknown): ClonedVoicePublicRow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.status !== 'string') {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    language: typeof row.language === 'string' ? row.language : null,
    name: typeof row.name === 'string' ? row.name : null,
    voice_id: typeof row.voice_id === 'string' ? row.voice_id : null,
    error_code: typeof row.error_code === 'string' ? row.error_code : null,
    consent_at: typeof row.consent_at === 'string' ? row.consent_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}
