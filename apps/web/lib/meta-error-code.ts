//---------------
// readMetaErrorCode — Meta's Graph error envelope carries the provider error
// code as a number ({ error: { code, message, type } }). The code is what
// tells a dead token (190, OAuthException) apart from any other 400, so the
// Instagram, Facebook, and Threads libs preserve it on the thrown error
// instead of dropping it with the body.
//
// It lives under `providerCode`, never `code`: httpStatusOf treats a numeric
// `code` field as an HTTP status, and 190 is not one.
//---------------
export function readMetaErrorCode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}
