//---------------
// Central application logger.
//
// Development/test: console only.
// Production: errors and warnings are also reported to PostHog
// (error tracking + analytics) so handled failures show up there,
// not only in Vercel logs. info/debug stay console-only in every
// environment to keep PostHog free of noise.
//---------------

import { getPostHogServer } from './posthog-server';

//---------------
// Environment routing (read at call time so tests can stub it)
//---------------

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

//---------------
// Supabase/PostgREST failures arrive as plain objects
// ({ message, code, details, hint }), not Error instances.
// Normalize them so PostHog groups issues with a useful message.
//---------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? '[unserializable]';
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return '[unserializable]';
  }
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (isRecord(cause) && typeof cause.message === 'string' && cause.message.length > 0) {
    return new Error(cause.message);
  }
  if (cause === undefined || cause === null) return new Error('Unknown error');
  return new Error(`Non-error value reported: ${safeJson(cause)}`);
}

//---------------
// Raw upstream bodies (engine responses, provider errors) can echo
// credential-shaped fragments: api_key query params, Bearer <redacted>,
// DSN userinfo, sk- secrets. Mirror the MCP's sanitizeEngineError
// convention: redact the fragments, then cap the length, before anything
// reaches PostHog. Applied here in the reporter so every logger.error
// caller is protected, not just the one that remembered to sanitize.
//---------------

const MAX_REPORT_BODY_CHARS = 200;

function redactCredentialFragments(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

function sanitizeReportBody(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return redactCredentialFragments(value).slice(0, MAX_REPORT_BODY_CHARS);
}

//---------------
// PostHog reporters — production only, and never allowed to throw.
// Telemetry must never break the request path.
//---------------

function reportErrorToPostHog(message: string, cause: unknown, metadata?: Record<string, unknown>): void {
  if (!isProduction()) return;
  try {
    const client = getPostHogServer();
    if (!client) return;
    const error = toError(cause);
    // PostHog error tracking ingests $exception events with these properties.
    // Keep the raw failure (e.g. the PostgREST { message, code, details, hint }
    // object) in properties so the PostHog issue shows the real database error.
    // String causes (raw upstream bodies) are sanitized first: credential
    // fragments redacted, length capped — see sanitizeReportBody.
    const properties: Record<string, unknown> = {
      $exception_message: error.message,
      $exception_type: error.name,
      $exception_stacktrace: error.stack,
      log_message: message,
      ...metadata,
    };
    if (!(cause instanceof Error) && cause !== undefined) properties['cause'] = sanitizeReportBody(cause);
    client.capture('$exception', properties);
  } catch {
    // Telemetry must never break the request path.
  }
}

function reportWarningToPostHog(message: string, metadata?: Record<string, unknown>): void {
  if (!isProduction()) return;
  try {
    const client = getPostHogServer();
    if (!client) return;
    client.capture('server_warning', { message, ...metadata });
  } catch {
    // Telemetry must never break the request path.
  }
}

//---------------
// Console output (kept in production too: Vercel logs stay the raw trail).
//
// The call shape mirrors a direct console.* call on purpose: the message is
// always the first argument, metadata and the error follow as separate
// arguments. Route tests were written against that shape (e.g.
// toHaveBeenCalledWith(msg, expect.objectContaining(...))), so the logger
// must not merge everything into one prefixed string.
//---------------

function writeConsole(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  message: string,
  metadata?: Record<string, unknown>,
  error?: Error,
): string {
  const timestamp = new Date().toISOString();
  const logId = `${timestamp.slice(0, 10)}_${timestamp.slice(11, 19).replace(/:/g, '')}_${Math.random().toString(36).substring(2, 8)}`;

  const args: unknown[] = [message];
  if (metadata !== undefined) args.push(metadata);
  if (error !== undefined) args.push(error);

  if (level === 'ERROR') {
    console.error(...args);
  } else if (level === 'WARN') {
    console.warn(...args);
  } else {
    console.log(...args);
  }

  return logId;
}

//---------------
// Logger class
//---------------

class Logger {
  //---------------
  // Public API: generateLogId
  //---------------

  public generateLogId(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `${date}_${time}_${random}`;
  }

  //---------------
  // Public API: core logging methods (return logId for chaining)
  //---------------

  info(message: string, metadata?: Record<string, unknown>): string {
    return writeConsole('INFO', message, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): string {
    return writeConsole('DEBUG', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): string {
    const logId = writeConsole('WARN', message, metadata);
    reportWarningToPostHog(message, metadata);
    return logId;
  }

  error(message: string, cause?: unknown, metadata?: Record<string, unknown>): string {
    // Only attach the error to the console call when a cause was actually
    // given: toHaveBeenCalledWith(msg, meta) assertions require the exact
    // argument list.
    const logId = writeConsole('ERROR', message, metadata, cause === undefined ? undefined : toError(cause));
    reportErrorToPostHog(message, cause, metadata);
    return logId;
  }

  //---------------
  // Public API: specialized logging methods (void return, drop-in compatible).
  // Console format is unchanged; error variants also report to PostHog.
  //---------------

  logUploadStart(logId: string, metadata: Record<string, unknown>): void {
    console.log('[INFO] [UPLOAD_START]', messageWithLogId(logId, 'Upload started'), metadata);
  }

  logUploadProgress(logId: string, progress: { uploadedBytes: number; totalBytes: number; percentage: number }): void {
    console.log('[DEBUG] [UPLOAD_PROGRESS]', messageWithLogId(logId, `Upload progress: ${progress.percentage}%`), progress);
  }

  logUploadSuccess(logId: string, result: { videoId: string; videoUrl: string; duration: number }): void {
    console.log('[INFO] [UPLOAD_SUCCESS]', messageWithLogId(logId, 'Upload completed successfully'), result);
  }

  logUploadError(logId: string, error: Error, metadata: Record<string, unknown>): void {
    console.error('[ERROR] [UPLOAD_ERROR]', messageWithLogId(logId, 'Upload error'), metadata, error);
    reportErrorToPostHog('Upload error', error, { logId, ...metadata });
  }

  logOAuthStart(logId: string): void {
    console.log('[INFO] [OAUTH_START]', messageWithLogId(logId, 'OAuth flow started'));
  }

  logOAuthCallback(logId: string, code?: string): void {
    console.log('[INFO] [OAUTH_CALLBACK]', messageWithLogId(logId, 'OAuth callback received'), { hasCode: !!code });
  }

  logOAuthSuccess(logId: string, tokens: { access_token?: string; refresh_token?: string }): void {
    console.log('[INFO] [OAUTH_SUCCESS]', messageWithLogId(logId, 'OAuth completed successfully'), {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
    });
  }

  logOAuthError(logId: string, error: Error): void {
    console.error('[ERROR] [OAUTH_ERROR]', messageWithLogId(logId, 'OAuth flow error'), error);
    reportErrorToPostHog('OAuth flow error', error, { logId });
  }

  logInstagramAuthStart(logId: string): void {
    console.log('[INFO] [INSTAGRAM_OAUTH_START]', messageWithLogId(logId, 'Instagram OAuth flow started'));
  }

  logInstagramAuthCallback(logId: string, code?: string): void {
    console.log('[INFO] [INSTAGRAM_OAUTH_CALLBACK]', messageWithLogId(logId, 'Instagram OAuth callback received'), { hasCode: !!code });
  }

  logInstagramAuthSuccess(logId: string): void {
    console.log('[INFO] [INSTAGRAM_OAUTH_SUCCESS]', messageWithLogId(logId, 'Instagram OAuth completed successfully'));
  }

  logInstagramAuthError(logId: string, error: Error): void {
    console.error('[ERROR] [INSTAGRAM_OAUTH_ERROR]', messageWithLogId(logId, 'Instagram OAuth flow error'), error);
    reportErrorToPostHog('Instagram OAuth flow error', error, { logId });
  }

  logInstagramPostStart(logId: string, igUserId: string): void {
    console.log('[INFO] [INSTAGRAM_POST_START]', messageWithLogId(logId, 'Starting Instagram post'), { igUserId });
  }

  logInstagramPostSuccess(logId: string, postId: string): void {
    console.log('[INFO] [INSTAGRAM_POST_SUCCESS]', messageWithLogId(logId, 'Instagram post created successfully'), { postId });
  }

  logInstagramPostError(logId: string, error: Error): void {
    console.error('[ERROR] [INSTAGRAM_POST_ERROR]', messageWithLogId(logId, 'Error creating Instagram post'), error);
    reportErrorToPostHog('Error creating Instagram post', error, { logId });
  }
}

//---------------
// Helper for consistent message format in specialized methods
//---------------

function messageWithLogId(logId: string, message: string): string {
  return `[${logId}] ${message}`;
}

//---------------
// Singleton instance
//---------------

export const logger = new Logger();
