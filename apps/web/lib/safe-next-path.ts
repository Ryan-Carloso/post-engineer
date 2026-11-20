export function isSafeNextPath(value: string | null | undefined): value is string {
  if (value === null || value === undefined || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return false;
  }
  try {
    return new URL(value, 'http://localhost').origin === 'http://localhost';
  } catch {
    return false;
  }
}

export function safeNextPath(value: string | null): string {
  return isSafeNextPath(value) ? value : '/';
}
