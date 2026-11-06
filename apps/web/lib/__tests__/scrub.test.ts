//---------------
// scrub — shared secret-scrubbing for PostHog-bound metadata.
//
// One policy for every reporter: keys that look secret-bearing
// (tokens, passwords, auth headers, ...) are redacted before logging.
// The scrub is recursive (depth-capped) so nested objects and arrays
// are redacted too. The value is replaced, the key is kept, so the
// presence of the field stays visible for debugging.
//---------------

import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '@/lib/scrub';

describe('scrubSecrets', () => {
  it('redacts secret-bearing keys (case-insensitive), keeps the key', () => {
    const out = scrubSecrets({
      password: 'hunter2',
      apiKey: 'sk-123',
      Authorization: 'Bearer abc',
      accessToken: 'tok',
      safe: 'ok',
    });
    expect(out['password']).toBe('[redacted]');
    expect(out['apiKey']).toBe('[redacted]');
    expect(out['Authorization']).toBe('[redacted]');
    expect(out['accessToken']).toBe('[redacted]');
    expect(out['safe']).toBe('ok');
  });

  it('redacts nested records recursively', () => {
    const out = scrubSecrets({
      outer: { inner: { secret: 's', count: 3 } },
    })['outer'] as Record<string, unknown>;
    const inner = out['inner'] as Record<string, unknown>;
    expect(inner['secret']).toBe('[redacted]');
    expect(inner['count']).toBe(3);
  });

  it('redacts records inside arrays', () => {
    const out = scrubSecrets({
      items: [{ token: 't', n: 1 }, { n: 2 }],
    })['items'] as Record<string, unknown>[];
    expect(out[0]['token']).toBe('[redacted]');
    expect(out[0]['n']).toBe(1);
    expect(out[1]['n']).toBe(2);
  });

  it('redacts credential fragments inside nested message strings', () => {
    // A validation `errors` list echoes caller text. Key-name scrubbing
    // leaves `message` alone, so a pasted token must be fragment-redacted
    // before the list reaches PostHog.
    const token = 'sk-' + 'a'.repeat(24);
    const out = scrubSecrets({
      errors: [
        {
          code: 'VALIDATION_FAILED',
          message: `Invalid provider: "Bearer ${token}".`,
          field: 'publishing.providers',
        },
        { code: 'VALIDATION_FAILED', message: 'Invalid provider: "myspace".' },
      ],
      notes: [`leaked Bearer ${token} here`],
    });
    const errors = out['errors'] as Array<Record<string, unknown>>;
    // The fragment regex consumes the trailing non-space characters (the
    // closing quote), which is the existing Bearer rule, not a new one.
    expect(errors[0]['message']).toBe('Invalid provider: "Bearer [redacted]');
    expect(errors[0]['message']).not.toContain(token);
    expect(errors[1]['message']).toBe('Invalid provider: "myspace".');
    expect(out['notes']).toEqual(['leaked Bearer [redacted] here']);
  });

  it('keeps non-string values that are not secret-bearing', () => {
    const out = scrubSecrets({ count: 3, flag: true, nothing: null });
    expect(out).toEqual({ count: 3, flag: true, nothing: null });
  });

  it('does not mutate the input', () => {
    const input = { password: 'x', nested: { token: 'y' } };
    scrubSecrets(input);
    expect(input['password']).toBe('x');
    expect((input['nested'] as Record<string, unknown>)['token']).toBe('y');
  });
});
