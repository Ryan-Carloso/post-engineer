export function narrowScriptAngle(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
