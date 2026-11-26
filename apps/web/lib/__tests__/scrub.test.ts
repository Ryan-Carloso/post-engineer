import { describe, it, expect } from 'vitest';
import { ENGINE_REASON_MAX_CHARS, sanitizeEngineReason, scrubSecrets } from '@/lib/scrub';

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

describe('sanitizeEngineReason', () => {
  it('redacts Bearer tokens, URL userinfo, token/api_key query params and sk- secrets', () => {
    const token = 'sk-' + 'a'.repeat(24);
    const out = sanitizeEngineReason(
      `Rejected: Bearer ${token} from https://user:pass@host.example/x?token=abc&api_key=def`,
    );
    expect(out).not.toContain(token);
    expect(out).not.toContain('pass@host');
    expect(out).not.toContain('token=abc');
    expect(out).not.toContain('api_key=def');
    expect(out).toContain('Bearer [redacted]');
    expect(out).toContain('https://[redacted]@host.example/x');
    expect(out).toContain('token=[redacted]');
    expect(out).toContain('api_key=[redacted]');
  });

  it('reduces absolute Unix paths to their basename', () => {
    expect(sanitizeEngineReason('failed to load /home/app/storage/tasks/abc/final.mp4')).toBe(
      'failed to load final.mp4',
    );
  });

  it('reduces Windows paths to their basename', () => {
    expect(sanitizeEngineReason('failed to load C:\\app\\x\\voice.wav')).toBe(
      'failed to load voice.wav',
    );
  });

  it('leaves URL paths alone, redacting only secret query params', () => {
    expect(sanitizeEngineReason('see https://host.example/a/b.mp4?token=secret')).toBe(
      'see https://host.example/a/b.mp4?token=[redacted]',
    );
  });

  it('never returns more than ENGINE_REASON_MAX_CHARS characters', () => {
    expect(ENGINE_REASON_MAX_CHARS).toBe(200);
    expect(sanitizeEngineReason('x'.repeat(500))).toHaveLength(ENGINE_REASON_MAX_CHARS);
  });

  it('scrubs before truncating, so no raw fragment survives past the boundary', () => {
    const token = 'sk-' + 'b'.repeat(24);
    const out = sanitizeEngineReason('y'.repeat(180) + ` Bearer ${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain('sk-');
    expect(out).toContain('Bearer [redacted]');
  });

  it('scrubs a bare sk- key before truncating, so no key fragment survives past the boundary', () => {
    const key = 'sk-' + 'b'.repeat(25);
    const out = sanitizeEngineReason('y'.repeat(192) + ` ${key}`);
    expect(out).not.toContain('sk-');
    expect(out).not.toContain(key);
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeEngineReason('  a\n  b\t c  ')).toBe('a b c');
  });

  it('returns null for empty or blank input', () => {
    expect(sanitizeEngineReason('')).toBeNull();
    expect(sanitizeEngineReason('   ')).toBeNull();
  });
});
