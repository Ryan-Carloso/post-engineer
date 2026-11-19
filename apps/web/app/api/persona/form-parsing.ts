export function parseJsonStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
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
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('imagePrimaryIndex must be a non-negative integer.');
  }
  return Number.parseInt(trimmed, 10);
}
