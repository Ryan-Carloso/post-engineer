import { describe, it, expect } from 'vitest';
import { getErrorMessage, ImageTooLargeError } from '../errors.js';

describe('getErrorMessage', () => {
  it('returns the message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error thrown values', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('ImageTooLargeError', () => {
  it('carries the path and size with a message derived from the shared limit', () => {
    const error = new ImageTooLargeError('/tmp/photos/a.jpg', 11 * 1024 * 1024);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ImageTooLargeError');
    expect(error.path).toBe('/tmp/photos/a.jpg');
    expect(error.sizeBytes).toBe(11 * 1024 * 1024);
    // The max in the message comes from the shared derived constant, never
    // a literal or a locally recomputed divisor.
    expect(error.message).toBe(
      'Image "/tmp/photos/a.jpg" is too large (11534336 bytes; max 10MB).'
    );
  });
});
