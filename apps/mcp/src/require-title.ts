// Fail-fast for title inputs: the route 400s on an empty title, so trim
// and reject here, before any fetch goes out. Returns the trimmed title:
// the server stores the trimmed value, so the payload carries exactly
// what lands.
export function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('title must be a non-empty string.');
  }
  return trimmed;
}
