//---------------
// Shared secret-scrubbing for PostHog-bound metadata.
//
// One policy for every reporter (analytics.ts, logger.ts):
// metadata keys that look secret-bearing (tokens, passwords, auth
// headers, ...) are redacted before logging — never pass raw request
// bodies, signed URLs, or credentials here.
//---------------

// Metadata keys matching this pattern are redacted before logging.
// Matched case-insensitively; the value is replaced, the key is kept so
// the presence of the field stays visible for debugging.
const SECRET_KEY_PATTERN =
  /password|passwd|secret|token|authorization|auth\b|api[-_]?key|bearer|credential|private[-_]?key|session/i;

const REDACTED = '[redacted]';

// Maximum recursion depth for scrubSecrets — metadata is caller-controlled
// and flat by contract, so this is defense in depth, not a hot path.
const MAX_SCRUB_DEPTH = 5;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function scrubSecrets(metadata: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      scrubbed[key] = REDACTED;
    } else if (depth < MAX_SCRUB_DEPTH && isPlainRecord(value)) {
      scrubbed[key] = scrubSecrets(value, depth + 1);
    } else if (depth < MAX_SCRUB_DEPTH && Array.isArray(value)) {
      scrubbed[key] = value.map((item) =>
        isPlainRecord(item) ? scrubSecrets(item, depth + 1) : item,
      );
    } else if (value instanceof Error) {
      // Errors have no enumerable own properties — Object.entries would
      // yield {}. Preserve the message instead of silently emptying.
      scrubbed[key] = { message: value.message, name: value.name };
    } else if (value instanceof Date) {
      scrubbed[key] = value.toISOString();
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

//---------------
// Redact credential-shaped fragments inside free-text strings.
// Catches Bearer tokens, userinfo in URLs, api_key query params, and
// sk-... secrets that key-name scrubbing misses (e.g. inside message
// strings or upstream bodies).
//---------------
export function redactCredentialFragments(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
}
