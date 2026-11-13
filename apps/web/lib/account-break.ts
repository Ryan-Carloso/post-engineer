//---------------
// account-break — which provider failures mean the connected account
// itself is broken (issue #558). Pure: no mailer, no PostHog, no
// server-only import, so the publish and sync leaves can share it
// without a cycle.
//
// A server misconfiguration (TOKEN_ENCRYPTION_KEY missing or the wrong
// size) is not a broken account: that would email every user.
// 403, 429, 5xx, network, and a local expiry date are not either.
//---------------

export type AccountBreakClass = 'token_undecryptable' | 'unauthorized' | 'email_not_verified';

const KEY_MISCONFIG = /TOKEN_ENCRYPTION_KEY (is not defined|must decode to exactly 32 bytes)/;

const UNDECRYPTABLE = /authentication tag|unable to authenticate data|Invalid encrypted token format or version|Decrypted payload is not an object|Failed to decrypt stored tokens/i;

function numericField(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null || !(key in source)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

//---------------
// httpStatusOf — the HTTP status a provider SDK error carries, whichever shape
// it uses (axios `response.status`, gaxios/Google `code`/`status`, our own
// InstagramApiError `statusCode`).
//---------------
export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = 'response' in error ? (error as { response?: unknown }).response : undefined;
  return (
    numericField(response, 'status') ??
    numericField(error, 'status') ??
    numericField(error, 'statusCode') ??
    numericField(error, 'code')
  );
}

export function isUnauthorizedError(error: unknown): boolean {
  if (httpStatusOf(error) === 401) return true;
  if (isNamedCode(error, 'BlueskyError', 'invalid_credentials')) return true;
  if (isNamedCode(error, 'ThreespeakError', 'invalid_credentials')) return true;
  if (isNamedCode(error, 'RumbleError', 'invalid_token')) return true;
  return error instanceof Error && /^unauthorized$/i.test(error.message.trim());
}

//---------------
// isNamedCode — duck-typed provider error (name + code) so this leaf stays
// free of the Bluesky, 3Speak, and Rumble client imports.
// Bluesky and 3Speak never carry a numeric 401: a dead credential surfaces
// as code 'invalid_credentials'. Rumble answers a bad access token with
// code 'invalid_token'.
//---------------
function isNamedCode(error: unknown, name: string, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.name === name && record.code === code;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

//---------------
// classifyAccountBreak — the three classes that email the owner.
// Order: key misconfig (never), Bluesky email_not_verified, unauthorized,
// then an undecryptable stored token. Anything else is null.
//---------------
export function classifyAccountBreak(error: unknown): AccountBreakClass | null {
  const message = errorText(error);
  if (KEY_MISCONFIG.test(message)) return null;
  if (isNamedCode(error, 'BlueskyError', 'email_not_verified')) return 'email_not_verified';
  if (isUnauthorizedError(error)) return 'unauthorized';
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === 'TokenDecryptError' || UNDECRYPTABLE.test(message)) return 'token_undecryptable';
  return null;
}
