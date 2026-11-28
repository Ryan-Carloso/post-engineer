import { createHash, randomUUID } from 'node:crypto';

export const IDEMPOTENCY_NAMESPACE = 'unified-generate-schedule/v1';

export const PUBLISH_EXISTING_NAMESPACE = 'publish-existing/v1';

export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash('sha256').update(`${namespace}:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}` +
    `-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

export interface ResolvedIdempotency {
  key: string;
  clientSupplied: boolean;
  scheduleId: string;
  generationId: string;
}

export function resolveIdempotency(
  userId: string,
  bodyKey: unknown,
  request: Request,
  namespace: string = IDEMPOTENCY_NAMESPACE,
): ResolvedIdempotency {
  const headerKey = request.headers.get('idempotency-key');
  const raw = typeof bodyKey === 'string' && bodyKey.trim().length > 0
    ? bodyKey.trim()
    : typeof headerKey === 'string' && headerKey.trim().length > 0
      ? headerKey.trim()
      : null;
  const key = raw ?? randomUUID();
  const scheduleId = deterministicUuid(namespace, `${userId}:${key}`);
  return {
    key,
    clientSupplied: raw !== null,
    scheduleId,
    generationId: `batch:${scheduleId}`,
  };
}
