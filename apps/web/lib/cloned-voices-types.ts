// The public row is the shared contract's ClonedVoiceRow; the alias keeps
// the existing import sites working.
import type { ClonedVoiceRow as ClonedVoicePublicRow } from '@/lib/contracts/voices';

export type { ClonedVoicePublicRow };

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
    voice_id: typeof row.voice_id === 'string' ? row.voice_id : null,
    error_code: typeof row.error_code === 'string' ? row.error_code : null,
    consent_at: typeof row.consent_at === 'string' ? row.consent_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}
