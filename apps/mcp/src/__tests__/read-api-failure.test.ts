import { describe, it, expect } from 'vitest';
import { readApiFailure } from '../errors.js';

describe('readApiFailure', () => {
  it('keeps a non-JSON body as capped text with no code or field', () => {
    const raw = 'x'.repeat(250);
    const failure = readApiFailure(raw);
    expect(failure.detail).toBe('x'.repeat(200));
    expect(failure.code).toBeNull();
    expect(failure.field).toBeNull();
  });

  it('uses the top-level error when the errors list has a single message', () => {
    const failure = readApiFailure(JSON.stringify({
      error: 'title is required',
      code: 'VALIDATION_FAILED',
      field: 'title',
      errors: [{ message: 'a different single problem' }, { message: 12 }, null, 'nope'],
    }));
    expect(failure.detail).toBe('title is required');
    expect(failure.code).toBe('VALIDATION_FAILED');
    expect(failure.field).toBe('title');
  });

  it('joins every listed message when the API reports more than one', () => {
    const failure = readApiFailure(JSON.stringify({
      error: 'first only',
      errors: [
        { message: 'title is required' },
        { message: 'provider is invalid' },
      ],
    }));
    expect(failure.detail).toBe('title is required provider is invalid');
    expect(failure.code).toBeNull();
    expect(failure.field).toBeNull();
  });

  it('ignores an empty error string and non-string code or field', () => {
    const body = JSON.stringify({ error: '', code: 12, field: false, errors: [] });
    const failure = readApiFailure(body);
    expect(failure.detail).toBe(body);
    expect(failure.code).toBeNull();
    expect(failure.field).toBeNull();
  });

  it('caps a joined list at 200 characters', () => {
    const failure = readApiFailure(JSON.stringify({
      error: 'short',
      errors: [{ message: 'a'.repeat(180) }, { message: 'b'.repeat(80) }],
    }));
    expect(failure.detail).toHaveLength(200);
    expect(failure.detail.startsWith('a'.repeat(180))).toBe(true);
  });
});
