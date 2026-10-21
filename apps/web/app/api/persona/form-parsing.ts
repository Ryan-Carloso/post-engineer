//---------------
// Form-field parsers for the persona routes: the optional JSON string
// arrays and the primary-image index sent as multipart fields.
//---------------

//---------------
// parseJsonStringArray — reads an optional JSON array of strings from a
// multipart field (e.g. imageTags). Returns [] on missing/invalid input.
//---------------
export function parseJsonStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  // Malformed JSON is a client bug, not a silent default: throwing here
  // becomes a 400 at the call site instead of empty tags/descriptions.
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('imageTags/imageDescriptions must be a JSON array of strings.');
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('imageTags/imageDescriptions must be a JSON array of strings.');
  }
  return parsed;
}

export function parsePrimaryIndex(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  // A non-empty but non-numeric value is a client bug, not a silent
  // default: silently dropping it would lose the caller's pinned primary
  // selection. Strict digits only — parseInt('3x') === 3 would coerce.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('imagePrimaryIndex must be a non-negative integer.');
  }
  return Number.parseInt(trimmed, 10);
}
