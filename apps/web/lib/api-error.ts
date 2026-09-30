//---------------
// Shared API error responder.
//
// Every Web API error response (4xx and 5xx) flows through apiErrorResponse
// so Bugsink receives enough structured context to debug the real cause,
// while clients only see safe public messages. The returned errorId is the
// logger's logId: users can report it and we can find the exact event.
//
// Safety rules:
// - 4xx (user/input errors) are logged as warnings; 5xx as errors with the
//   underlying cause, so Bugsink captures the real failure.
// - Metadata keys that look secret-bearing (tokens, passwords, auth
//   headers, ...) are redacted before logging — never pass raw request
//   bodies, signed URLs, or credentials here.
// - Telemetry must never break the request path: logging is wrapped so a
//   throwing logger still yields a valid error response.
//---------------

import { NextResponse } from 'next/server';
import { logger } from './logger';

export interface ApiErrorOptions {
  // Route identifier for debugging, e.g. 'POST /api/schedule'.
  route?: string;
  // Underlying failure for 5xx — reported to Bugsink as the exception cause.
  // Keep it out of the client response: only the public message is returned.
  cause?: unknown;
  // Stable template for the Bugsink log message. When the public error
  // embeds user-controlled input (e.g. a malformed field value), pass a
  // stable template here so Bugsink groups by the template instead of
  // creating one issue per distinct input; put the raw value (truncated)
  // in metadata. Defaults to the public error message.
  logMessage?: string;
  // Safe metadata only: ids, counts, validated enums. Never auth headers,
  // tokens, passwords, app passwords, raw request bodies, or signed URLs.
  // Logged to Bugsink, never returned to the client.
  metadata?: Record<string, unknown>;
  // Extra client-safe fields merged into the JSON response body
  // (e.g. { code: 'INSUFFICIENT_TOKENS' }). Also logged for debugging.
  // Must be client-safe: no internals, no secrets.
  extra?: Record<string, unknown>;
}

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

function scrubSecrets(metadata: Record<string, unknown>, depth = 0): Record<string, unknown> {
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

function fallbackErrorId(): string {
  return `fallback_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

export function apiErrorResponse(
  status: number,
  error: string,
  options?: ApiErrorOptions,
): NextResponse {
  const route = options?.route ?? 'unknown route';
  // Extra response fields are safe by contract, but scrub them anyway:
  // defense in depth against a caller accidentally passing something secret.
  const extra = scrubSecrets({ ...(options?.extra ?? {}) });
  const metadata = scrubSecrets({ route, ...(options?.metadata ?? {}), ...extra });
  // The Bugsink message uses the stable template when provided, so
  // user-controlled input in the public error doesn't create one issue
  // per distinct value. The client still receives the detailed message.
  const logMessage = options?.logMessage ?? error;
  const message = `[${route}] ${status} ${logMessage}`;

  let errorId: string;
  try {
    if (status >= 500) {
      errorId = logger.error(message, options?.cause, metadata);
    } else {
      errorId = logger.warn(message, metadata);
    }
  } catch {
    // Telemetry must never break the request path.
    errorId = fallbackErrorId();
  }

  return NextResponse.json({ success: false, error, errorId, ...extra }, { status });
}
