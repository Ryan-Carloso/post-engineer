//---------------
// Shared secret-scrubbing for PostHog-bound metadata.
//
// One policy for every reporter (api-error.ts, analytics.ts, logger.ts):
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
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}
