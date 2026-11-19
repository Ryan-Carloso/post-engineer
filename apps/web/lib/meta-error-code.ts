export function readMetaErrorCode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

export function readMetaErrorSubcode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const subcode = (error as Record<string, unknown>).error_subcode;
  return typeof subcode === 'number' && Number.isFinite(subcode) ? subcode : undefined;
}
