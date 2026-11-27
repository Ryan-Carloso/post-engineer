import { describe, expect, it } from 'vitest';
import { AuthError, InstagramApiError, ValidationError } from '@/lib/errors';
import { uploadErrorStatus, uploadRejectionCode } from '@/lib/upload/upload-error-status';

describe('uploadErrorStatus', () => {
  it('maps each app error to its HTTP status', () => {
    expect(uploadErrorStatus(new ValidationError('bad', 'title'))).toBe(400);
    expect(uploadErrorStatus(new AuthError('no', 'invalid_token'))).toBe(401);
    expect(uploadErrorStatus(new InstagramApiError('bad media', 422))).toBe(422);
  });

  it('falls back to 500 for an Instagram error without a status and for unknown errors', () => {
    expect(uploadErrorStatus(new InstagramApiError('bad', 0))).toBe(500);
    expect(uploadErrorStatus(new Error('boom'))).toBe(500);
    expect(uploadErrorStatus('text')).toBe(500);
  });
});

describe('uploadRejectionCode', () => {
  it.each([
    [401, 'disconnected'],
    [403, 'disconnected'],
    [408, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [504, 'transient'],
    [400, 'publish_rejected'],
    [404, 'publish_rejected'],
    [422, 'publish_rejected'],
    [501, 'transient'],
  ])('classifies HTTP %i as %s', (status, code) => {
    expect(uploadRejectionCode(status)).toBe(code);
  });
});
