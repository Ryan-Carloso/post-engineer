import { getPostHogServer } from './posthog-server';
import { scrubSecrets, redactCredentialFragments } from './scrub';

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

export function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (isRecord(cause) && typeof cause.message === 'string' && cause.message.length > 0) {
    return new Error(cause.message);
  }
  if (cause === undefined || cause === null) return new Error('Unknown error');
  return new Error(`Non-error value reported: ${safeJson(cause)}`);
}

const MAX_REPORT_BODY_CHARS = 200;

function sanitizeReportBody(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactCredentialFragments(value).slice(0, MAX_REPORT_BODY_CHARS);
  }
  if (value !== null && typeof value === 'object') {
    try {
      const scrubbed = scrubSecrets(value as Record<string, unknown>);
      const json = JSON.stringify(scrubbed) ?? '[unserializable]';
      return redactCredentialFragments(json).slice(0, MAX_REPORT_BODY_CHARS);
    } catch {
      return '[unserializable]';
    }
  }
  return value;
}

function reportErrorToPostHog(message: string, cause: unknown, metadata?: Record<string, unknown>, logId?: string): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    const error = toError(cause);
    const safeMetadata = metadata ? scrubSecrets(metadata) : {};
    for (const [k, v] of Object.entries(safeMetadata)) {
      if (typeof v === 'string') safeMetadata[k] = sanitizeReportBody(v);
    }
    const properties: Record<string, unknown> = {
      $exception_message: redactCredentialFragments(error.message),
      $exception_type: error.name,
      $exception_stacktrace: error.stack ? redactCredentialFragments(error.stack) : error.stack,
      log_message: message,
      logId,
      ...safeMetadata,
    };
    if (!(cause instanceof Error) && cause !== undefined) properties['cause'] = sanitizeReportBody(cause);
    error.message = String(properties['$exception_message']);
    if (typeof properties['$exception_stacktrace'] === 'string') {
      error.stack = properties['$exception_stacktrace'];
    }
    client.captureException(error, properties);
  } catch {
  }
}

function reportWarningToPostHog(message: string, metadata?: Record<string, unknown>, logId?: string): void {
  try {
    const client = getPostHogServer();
    if (!client) return;
    const safeMetadata = metadata ? scrubSecrets(metadata) : {};
    for (const [k, v] of Object.entries(safeMetadata)) {
      if (typeof v === 'string') safeMetadata[k] = sanitizeReportBody(v);
    }
    client.capture('server_warning', {
      message: redactCredentialFragments(message),
      logId,
      ...safeMetadata,
    });
  } catch {
  }
}

function writeConsole(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  message: string,
  metadata?: Record<string, unknown>,
  error?: Error,
): string {
  const timestamp = new Date().toISOString();
  const logId = `${timestamp.slice(0, 10)}_${timestamp.slice(11, 19).replace(/:/g, '')}_${crypto.randomUUID().replace(/-/g, '').substring(0, 6)}`;

  const metaWithId = { logId, ...(metadata ?? {}) };
  const args: unknown[] = [message, metaWithId];
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

class Logger {

  public generateLogId(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const random = crypto.randomUUID().replace(/-/g, '').substring(0, 6);
    return `${date}_${time}_${random}`;
  }

  info(message: string, metadata?: Record<string, unknown>): string {
    return writeConsole('INFO', message, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): string {
    return writeConsole('DEBUG', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): string {
    const logId = writeConsole('WARN', message, metadata);
    reportWarningToPostHog(message, metadata, logId);
    return logId;
  }

  error(message: string, cause?: unknown, metadata?: Record<string, unknown>): string {
    const logId = writeConsole('ERROR', message, metadata, cause === undefined ? undefined : toError(cause));
    reportErrorToPostHog(message, cause, metadata, logId);
    return logId;
  }

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

function messageWithLogId(logId: string, message: string): string {
  return `[${logId}] ${message}`;
}

export const logger = new Logger();
