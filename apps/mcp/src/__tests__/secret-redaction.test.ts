import { describe, expect, it } from 'vitest';
import { redactSecretFromError } from '../secret-redaction.js';

describe('redactSecretFromError', () => {
  it('removes the raw secret from the message', () => {
    const error = redactSecretFromError(new Error("invalid postingKey value '5Ksecret-key'"), '5Ksecret-key');
    expect(error.message).not.toContain('5Ksecret-key');
    expect(error.message).toContain('[redacted]');
  });

  it('removes the percent-encoded secret', () => {
    const secret = 'p@ss word/123';
    const error = redactSecretFromError(new Error(`bad value '${encodeURIComponent(secret)}'`), secret);
    expect(error.message).not.toContain(encodeURIComponent(secret));
    expect(error.message).toContain('[redacted]');
  });

  it('removes the JSON-escaped secret', () => {
    const secret = 'p@ss"word\\123';
    const error = redactSecretFromError(new Error(`bad value '${JSON.stringify(secret).slice(1, -1)}'`), secret);
    expect(error.message).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('[redacted]');
  });

  it('passes a message through unchanged when the secret is empty', () => {
    const error = redactSecretFromError(new Error('plain failure'), '');
    expect(error.message).toBe('plain failure');
  });

  it('keeps the rest of the message intact', () => {
    const error = redactSecretFromError(new Error('Failed to connect 3Speak account: 422 bad key 5Ksecret-key'), '5Ksecret-key');
    expect(error.message).toBe('Failed to connect 3Speak account: 422 bad key [redacted]');
  });
});
