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

function scrubSecrets(metadata: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
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
  const message = `[${route}] ${status} ${error}`;

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
