export function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('title must be a non-empty string.');
  }
  return trimmed;
}
