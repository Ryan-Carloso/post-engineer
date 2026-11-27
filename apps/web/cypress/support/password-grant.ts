export const PASSWORD_GRANT_MAX_ATTEMPTS = 3;
const PASSWORD_GRANT_BACKOFF_BASE_MS = 1000;
export const PASSWORD_GRANT_BACKOFF_CAP_MS = 8000;
export const PASSWORD_GRANT_RETRY_AFTER_CAP_MS = 30_000;
export const SESSION_EXPIRY_SKEW_MS = 30_000;

const ERROR_CODE = /^[A-Za-z0-9_]+$/;
const EXPIRES_AT_MS_THRESHOLD = 10_000_000_000;

export type PasswordGrantStep =
  | { action: 'succeed' }
  | { action: 'retry'; delayMs: number }
  | { action: 'fail'; message: string };

function passwordGrantFailureMessage(
  status: number,
  attempts: number,
  errorCode: string | null,
): string {
  const code = errorCode === null ? '' : ` ${errorCode}`;
  if (status === 429) {
    return `Supabase password grant was rate limited (HTTP 429${code}) after ${attempts} attempts`;
  }
  return `Supabase password grant failed with HTTP ${status}${code} on attempt ${attempts}`;
}

export function passwordGrantErrorCode(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const candidates = [body.error_code, body.error];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= 64 &&
      ERROR_CODE.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function passwordGrantDelayMs(attempt: number, retryAfter: string | null, nowMs: number): number {
  const headerDelay = retryAfterDelayMs(retryAfter, nowMs);
  if (headerDelay !== null) {
    return Math.min(PASSWORD_GRANT_RETRY_AFTER_CAP_MS, headerDelay);
  }
  const exponential = PASSWORD_GRANT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(PASSWORD_GRANT_BACKOFF_CAP_MS, exponential);
}

const RETRY_WAIT_MARGIN_MS = 5_000;

export function retryWaitTimeoutMs(delayMs: number): number {
  return delayMs + RETRY_WAIT_MARGIN_MS;
}

export function passwordGrantStep(input: {
  status: number;
  attempt: number;
  retryAfter: string | null;
  nowMs: number;
  errorCode: string | null;
}): PasswordGrantStep {
  if (input.status === 200) {
    return { action: 'succeed' };
  }
  if (input.status !== 429 || input.attempt >= PASSWORD_GRANT_MAX_ATTEMPTS) {
    return {
      action: 'fail',
      message: passwordGrantFailureMessage(input.status, input.attempt, input.errorCode),
    };
  }
  return {
    action: 'retry',
    delayMs: passwordGrantDelayMs(input.attempt, input.retryAfter, input.nowMs),
  };
}

export function singleHeader(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return typeof first === 'string' ? first : null;
  }
  return null;
}

export function supabaseAuthCookieName(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

export function encodeSupabaseSessionCookie(session: unknown): string {
  const encoded = btoa(JSON.stringify(session))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `base64-${encoded}`;
}

export function decodeSupabaseSessionCookie(value: string): unknown {
  if (!value.startsWith('base64-')) {
    throw new Error('E2E session cookie is missing the base64- prefix');
  }
  const payload = value.slice('base64-'.length);
  return decodeBase64UrlJson(payload);
}

export function isPasswordGrantSession(body: unknown): body is Record<string, unknown> {
  return isRecord(body) && typeof body.access_token === 'string' && body.access_token.length > 0;
}

export function sessionStillValid(session: unknown, nowMs: number): boolean {
  if (!isPasswordGrantSession(session)) {
    return false;
  }
  const expiresAtMs = readExpiresAtMs(session);
  if (expiresAtMs === null) {
    return false;
  }
  return expiresAtMs - nowMs > SESSION_EXPIRY_SKEW_MS;
}

function retryAfterDelayMs(retryAfter: string | null, nowMs: number): number | null {
  if (retryAfter === null) {
    return null;
  }
  const trimmed = retryAfter.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return Math.max(0, dateMs - nowMs);
}

function readExpiresAtMs(session: Record<string, unknown>): number | null {
  const expiresAt = session.expires_at;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt > EXPIRES_AT_MS_THRESHOLD ? expiresAt : expiresAt * 1000;
  }
  const accessToken = session.access_token;
  if (typeof accessToken !== 'string') {
    return null;
  }
  return jwtExpMs(accessToken);
}

function jwtExpMs(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length < 2 || parts[1].length === 0) {
    return null;
  }
  try {
    const payload = decodeBase64UrlJson(parts[1]);
    if (!isRecord(payload) || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function decodeBase64UrlJson(payload: string): unknown {
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const json = atob(`${padded}${'='.repeat(padLength)}`);
  return parseJson(json);
}

function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
