import { readMetaErrorCode, readMetaErrorSubcode } from '@/lib/meta-error-code';

export const FIRST_COMMENT_TIMEOUT_MS = 15_000;

export class FirstCommentError extends Error {
  readonly statusCode: number;
  readonly providerCode: number | undefined;
  readonly reason: string | undefined;

  constructor(message: string, statusCode: number, detail: { providerCode?: number; reason?: string } = {}) {
    super(message);
    this.name = 'FirstCommentError';
    this.statusCode = statusCode;
    this.providerCode = detail.providerCode;
    this.reason = detail.reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeFailure(body: Record<string, unknown> | null, status: number): string {
  if (body !== null) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === 'string' && error.message !== '') return error.message;
    if (typeof error === 'string' && error !== '') return error;
    if (typeof body.message === 'string' && body.message !== '') return body.message;
  }
  return `status ${status}`;
}

function readReason(body: Record<string, unknown> | null): string | undefined {
  if (body === null) return undefined;
  const error = body.error;
  if (!isRecord(error)) return undefined;
  const errors = error.errors;
  if (Array.isArray(errors) && isRecord(errors[0]) && typeof errors[0].reason === 'string') return errors[0].reason;
  if (typeof error.status === 'string') return error.status;
  return undefined;
}

export async function commentRequest(
  label: string,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FIRST_COMMENT_TIMEOUT_MS) });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new FirstCommentError(`${label}: ${describeFailure(body, response.status)}`, response.status, {
      providerCode: readMetaErrorCode(body),
      reason: readReason(body) ?? (readMetaErrorSubcode(body) === undefined ? undefined : String(readMetaErrorSubcode(body))),
    });
  }
  return body ?? {};
}

export function requireId(label: string, body: Record<string, unknown>): string {
  if (typeof body.id !== 'string' || body.id === '') {
    throw new FirstCommentError(`${label}: missing id`, 502);
  }
  return body.id;
}

export function formBody(params: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  };
}

export function jsonBody(payload: unknown, headers: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
