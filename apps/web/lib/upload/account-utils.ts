//---------------
// Common utilities for account fields sent via multipart.
//---------------

export function getAccountIdsFromFormData(formData: FormData, field: string): string[] {
  return Array.from(new Set(
    formData
      .getAll(field)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
}
