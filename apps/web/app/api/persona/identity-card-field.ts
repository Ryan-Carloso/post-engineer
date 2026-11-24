import { parseIdentityCardJson, type IdentityCard } from '@/lib/contracts/persona-identity-card';

export type IdentityCardField =
  | { status: 'absent' }
  | { status: 'clear' }
  | { status: 'set'; card: IdentityCard }
  | { status: 'invalid'; error: string };

export function parseIdentityCardField(entry: FormDataEntryValue | null): IdentityCardField {
  if (entry === null) return { status: 'absent' };
  if (typeof entry !== 'string') return { status: 'invalid', error: 'identityCard: must be a JSON text field' };
  const trimmed = entry.trim();
  if (trimmed === '') return { status: 'absent' };
  if (trimmed === 'null') return { status: 'clear' };
  const parsed = parseIdentityCardJson(entry);
  return parsed.ok ? { status: 'set', card: parsed.value } : { status: 'invalid', error: parsed.error };
}
