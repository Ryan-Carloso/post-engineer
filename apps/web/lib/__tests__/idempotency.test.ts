//---------------
// idempotency — deterministic schedule ids for retried requests.
//---------------

import { describe, expect, it } from 'vitest';

import { IDEMPOTENCY_NAMESPACE, deterministicUuid, resolveIdempotency } from '../idempotency';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/videos/generate-and-schedule', { headers });
}

describe('deterministicUuid', () => {
  it('returns a stable RFC-4122-shaped uuid for the same input', () => {
    const a = deterministicUuid('ns', 'user-1:key-1');
    const b = deterministicUuid('ns', 'user-1:key-1');
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
    // Version 5 + RFC 4122 variant bits.
    expect(a[14]).toBe('5');
    expect('89ab').toContain(a[19]);
  });

  it('differs across names and namespaces', () => {
    const base = deterministicUuid('ns', 'user-1:key-1');
    expect(deterministicUuid('ns', 'user-1:key-2')).not.toBe(base);
    expect(deterministicUuid('other', 'user-1:key-1')).not.toBe(base);
  });
});

describe('resolveIdempotency', () => {
  it('derives the schedule id from the body key', () => {
    const resolved = resolveIdempotency('user-1', 'key-1', req());
    expect(resolved.clientSupplied).toBe(true);
    expect(resolved.key).toBe('key-1');
    expect(resolved.scheduleId).toBe(deterministicUuid(IDEMPOTENCY_NAMESPACE, 'user-1:key-1'));
    // batch: prefix = the engine reconciler's prepaid-batch convention.
    expect(resolved.generationId).toBe(`batch:${resolved.scheduleId}`);
  });

  it('falls back to the Idempotency-Key header', () => {
    const resolved = resolveIdempotency('user-1', undefined, req({ 'idempotency-key': 'hdr-1' }));
    expect(resolved.clientSupplied).toBe(true);
    expect(resolved.scheduleId).toBe(deterministicUuid(IDEMPOTENCY_NAMESPACE, 'user-1:hdr-1'));
  });

  it('mints a per-request key when the client sends none', () => {
    const a = resolveIdempotency('user-1', undefined, req());
    const b = resolveIdempotency('user-1', undefined, req());
    expect(a.clientSupplied).toBe(false);
    expect(a.scheduleId).not.toBe(b.scheduleId);
  });

  it('scopes the schedule id by user', () => {
    const a = resolveIdempotency('user-1', 'key-1', req());
    const b = resolveIdempotency('user-2', 'key-1', req());
    expect(a.scheduleId).not.toBe(b.scheduleId);
  });
});
