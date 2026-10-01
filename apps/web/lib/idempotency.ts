//---------------
// idempotency — deterministic request identities for generate-and-schedule.
//
// Retried requests (double click, HTTP retry, MCP retry, timeout, reconnect)
// must never double-spend or duplicate schedules/slots/tasks. The client may
// send an idempotency key (body `idempotencyKey` or the `Idempotency-Key`
// header); when absent the server mints one per request (no replay possible,
// still safe).
//
// The schedule id is derived deterministically from (user, key), so a retry
// addresses the SAME schedule row: the insert either creates it or hits the
// PK and replays the existing one. No `uuid` dependency — node:crypto only.
//---------------

import { createHash, randomUUID } from 'node:crypto';

/** Namespace separating this operation's ids from any other deterministic id. */
export const IDEMPOTENCY_NAMESPACE = 'unified-generate-schedule/v1';

/**
 * Deterministic UUID (v5-style: SHA-256 based, version/variant bits set)
 * from a namespace + name. Same input always yields the same id.
 */
export function deterministicUuid(namespace: string, name: string): string {
  // codeql[js/insufficient-password-hash]: false positive — this hashes a
  // (namespace, userId:idempotencyKey) tuple to derive a deterministic UUID
  // for idempotent schedule identity, not a password or credential. SHA-256
  // is the correct primitive here; no password storage is involved.
  const hash = createHash('sha256').update(`${namespace}:${name}`).digest();
  // Set the version (5) and RFC 4122 variant bits on the first 16 bytes.
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}` +
    `-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

export interface ResolvedIdempotency {
  /** The client key, or a server-minted one when the client sent none. */
  key: string;
  /** True when the client supplied the key (replayable). */
  clientSupplied: boolean;
  /** Deterministic schedule id for (userId, key). */
  scheduleId: string;
  /** Canonical token spend id for the schedule. */
  generationId: string;
}

/**
 * Resolve the idempotency identity for a request. Prefers the body field,
 * then the `Idempotency-Key` header, then mints a per-request key.
 */
export function resolveIdempotency(
  userId: string,
  bodyKey: unknown,
  request: Request,
): ResolvedIdempotency {
  const headerKey = request.headers.get('idempotency-key');
  const raw = typeof bodyKey === 'string' && bodyKey.trim().length > 0
    ? bodyKey.trim()
    : typeof headerKey === 'string' && headerKey.trim().length > 0
      ? headerKey.trim()
      : null;
  const key = raw ?? randomUUID();
  const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${userId}:${key}`);
  return {
    key,
    clientSupplied: raw !== null,
    scheduleId,
    // `batch:` is the engine-side convention for prepaid batches: the
    // fill_schedule reconciler refunds failed slots under
    // `batch:{scheduleId}` and per-slot keys `{generationId}:slot:{slotId}`.
    // Using the same id here means the engine's refund path works for our
    // web-dispatched slots with zero engine changes.
    generationId: `batch:${scheduleId}`,
  };
}
