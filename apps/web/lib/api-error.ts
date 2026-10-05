//---------------
// Shared API error responder.
//
// Migrated Web API error responses (4xx and 5xx) flow through
// apiErrorResponse so PostHog receives enough structured context to debug
// the real cause, while clients only see safe public messages. The returned
// errorId is the logger's logId: users can report it and we can find the
// exact event.
//
// Safety rules:
// - 4xx (user/input errors) are logged as warnings; 5xx as errors with the
//   underlying cause, so PostHog captures the real failure.
// - Metadata keys that look secret-bearing (tokens, passwords, auth
//   headers, ...) are redacted before logging — never pass raw request
//   bodies, signed URLs, or credentials here.
// - Telemetry must never break the request path: logging is wrapped so a
//   throwing logger still yields a valid error response.
//---------------

import { NextResponse } from 'next/server';
import { logger } from './logger';
import { scrubSecrets, redactCredentialFragments } from './scrub';
import { markApiErrorReported } from './api-error-reporting';

export interface ApiErrorOptions {
  // Route identifier for debugging, e.g. 'POST /api/schedule'.
  route?: string;
  // Underlying failure — reported to PostHog as the exception cause on 5xx,
  // and as a serialized string in metadata on 4xx (logger.warn has no
  // cause parameter). Keep it out of the client response: only the public
  // message is returned.
  cause?: unknown;
  // Stable template for the PostHog log message. When the public error
  // embeds user-controlled input (e.g. a malformed field value), pass a
  // stable template here so PostHog groups by the template instead of
  // creating one issue per distinct input; put the raw value (truncated)
  // in metadata. Defaults to the public error message.
  logMessage?: string;
  // Safe metadata only: ids, counts, validated enums. Never auth headers,
  // tokens, passwords, app passwords, raw request bodies, or signed URLs.
  // Logged to PostHog, never returned to the client.
  metadata?: Record<string, unknown>;
  // Extra client-safe fields merged into the JSON response body
  // (e.g. { code: 'INSUFFICIENT_TOKENS' }). Also logged for debugging.
  // Must be client-safe: no internals, no secrets.
  extra?: Record<string, unknown>;
  // Stable machine-readable error code (see lib/error-codes.ts), returned
  // as a top-level `code` field so API, MCP and UI share one contract.
  // `error` stays the human-readable message (backwards compatible).
  code?: string;
  // Request field the error belongs to (e.g. 'publishing.accounts.youtube'),
  // so the UI can highlight the right input. Omitted when not field-specific.
  field?: string;
}

// Secret-scrubbing policy lives in ./scrub.ts (shared with analytics.ts):
// metadata keys that look secret-bearing are redacted before logging.

//---------------
// Public API: ApiErrorOptions
//---------------

function fallbackErrorId(): string {
  return `fallback_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// Serialize a cause for 4xx metadata. logger.warn has no cause parameter,
// so the cause rides in metadata instead of being silently dropped.
// Errors serialize to their message; other values are JSON-stringified
// (truncated) so PostHog shows something useful.
function serializeCause(cause: unknown): string {
  if (cause instanceof Error) return redactCredentialFragments(cause.message).slice(0, 300);
  try {
    const text = JSON.stringify(cause) ?? '[unserializable]';
    const capped = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    return redactCredentialFragments(capped);
  } catch {
    return '[unserializable]';
  }
}

export function apiErrorResponse(
  status: number,
  error: string,
  options?: ApiErrorOptions,
): NextResponse {
  const route = options?.route ?? 'unknown route';
  // Extra response fields are safe by contract, but scrub them anyway:
  // defense in depth against a caller accidentally passing something secret.
  // code/field are first-class: they ride in the body AND the logged
  // metadata so PostHog can group by code.
  const extra = scrubSecrets({
    ...(options?.code !== undefined ? { code: options.code } : {}),
    ...(options?.field !== undefined ? { field: options.field } : {}),
    ...(options?.extra ?? {}),
  });
  const metadata = scrubSecrets({ route, ...(options?.metadata ?? {}), ...extra });
  // The PostHog message uses the stable template when provided, so
  // user-controlled input in the public error doesn't create one issue
  // per distinct value. The client still receives the detailed message.
  const logMessage = options?.logMessage ?? error;
  const message = `[${route}] ${status} ${logMessage}`;

  let errorId: string;
  try {
    if (status >= 500) {
      errorId = logger.error(message, options?.cause, metadata);
    } else if (status === 401 || status === 403) {
      // Auth failures are console-only (no PostHog): unauthenticated scanner
      // traffic would otherwise become billable analytics volume. The
      // errorId is still returned so clients get a consistent shape.
      // Use %s format to avoid CodeQL format-string warning on the
      // interpolated route/status/message.
      console.warn('%s', `[${route}] ${status} ${logMessage}`, metadata);
      errorId = fallbackErrorId();
    } else if (options?.cause !== undefined) {
      // 4xx can carry a cause too (e.g. Stripe signature verification
      // failure) — logger.warn has no cause parameter, so serialize it
      // into metadata instead of silently dropping it.
      errorId = logger.warn(message, { ...metadata, cause: serializeCause(options.cause) });
    } else {
      errorId = logger.warn(message, metadata);
    }
  } catch {
    // Telemetry must never break the request path.
    errorId = fallbackErrorId();
  }

  const response = NextResponse.json({ success: false, error, errorId, ...extra }, { status });
  // logger.error above already reports 5xx to PostHog: mark the response so
  // withApiErrorReporting skips it instead of emitting a second $exception.
  if (status >= 500) markApiErrorReported(response);
  return response;
}
