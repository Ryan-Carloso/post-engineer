import { NextResponse } from 'next/server';
import { logger } from './logger';
import { scrubSecrets, redactCredentialFragments } from './scrub';
import { markApiErrorReported, attachApiErrorProperties } from './api-error-reporting';

export interface ApiErrorOptions {
  route?: string;
  cause?: unknown;
  logMessage?: string;
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  code?: string;
  leaveReportingToWrapper?: boolean;
  field?: string;
}

function fallbackErrorId(): string {
  return `fallback_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

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
  const extra = scrubSecrets({
    ...(options?.code !== undefined ? { code: options.code } : {}),
    ...(options?.field !== undefined ? { field: options.field } : {}),
    ...(options?.extra ?? {}),
  });
  const metadata = scrubSecrets({ route, ...(options?.metadata ?? {}), ...extra });
  const logMessage = options?.logMessage ?? error;
  const message = `[${route}] ${status} ${logMessage}`;

  let errorId: string;
  const leaveReportingToWrapper =
    options?.leaveReportingToWrapper === true && status < 500;
  try {
    if (status >= 500) {
      errorId = logger.error(message, options?.cause, metadata);
    } else if (status === 401 || status === 403 || leaveReportingToWrapper) {
      console.warn('%s', `[${route}] ${status} ${logMessage}`, metadata);
      errorId = fallbackErrorId();
    } else if (options?.cause !== undefined) {
      errorId = logger.warn(message, { ...metadata, cause: serializeCause(options.cause) });
    } else {
      errorId = logger.warn(message, metadata);
    }
  } catch {
    errorId = fallbackErrorId();
  }

  const publicError = redactCredentialFragments(error);
  const response = NextResponse.json(
    { success: false, error: publicError, errorId, ...extra },
    { status },
  );
  if (leaveReportingToWrapper) {
    attachApiErrorProperties(response, metadata);
  } else if (status >= 400 && status !== 401 && status !== 403) markApiErrorReported(response);
  return response;
}
