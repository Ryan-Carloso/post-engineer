export const AI_LABEL_FORM_VALUES = ['true', 'false'] as const;

export function invalidAiLabelMessage(value: unknown): string {
  return `Invalid aiLabel: ${String(value)}. Use true or false.`;
}

export function parseAiLabelFormValue(value: string | null): { ok: true; value: boolean | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (value === 'true') return { ok: true, value: true };
  if (value === 'false') return { ok: true, value: false };
  return { ok: false };
}
