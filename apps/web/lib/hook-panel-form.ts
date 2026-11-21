export const HOOK_PANEL_FORM_VALUES = ['true', 'false'] as const;

export function invalidHookPanelMessage(value: unknown): string {
  return `Invalid hookPanel: ${String(value)}. Use true or false.`;
}

export function parseHookPanelFormValue(value: string | null): { ok: true; value: boolean | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (value === 'true') return { ok: true, value: true };
  if (value === 'false') return { ok: true, value: false };
  return { ok: false };
}
