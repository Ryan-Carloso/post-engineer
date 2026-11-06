import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(() => 'warn-id'), error: vi.fn(() => 'error-id'), info: vi.fn() },
}));

import { personaValidationError, libraryImagesErrorField, forwardLibraryImagesError } from '../validation-error';
import { logger } from '@/lib/logger';

describe('personaValidationError', () => {
  it('returns a 400 with the VALIDATION_FAILED code and the field', async () => {
    const res = personaValidationError('tag must be a string.', 'POST /api/persona/images', { field: 'tag' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string; code: string; field: string };
    expect(body).toMatchObject({ success: false, error: 'tag must be a string.', code: 'VALIDATION_FAILED', field: 'tag' });
  });

  it('lets a caller-supplied code win (UNKNOWN_VOICE)', async () => {
    const res = personaValidationError('Unknown voice "x".', 'POST /api/persona', { code: 'UNKNOWN_VOICE' });
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_VOICE');
  });

  it('logs the stable logMessage instead of the client message', () => {
    personaValidationError('Only image files are accepted. (image 2: doc.pdf)', 'POST /api/persona', {
      logMessage: 'Only image files are accepted.',
    });
    const message = String(vi.mocked(logger.warn).mock.calls.at(-1)?.[0]);
    expect(message).toBe('[POST /api/persona] 400 Only image files are accepted.');
  });
});

describe('libraryImagesErrorField', () => {
  it('names the tag field for over-length tags', () => {
    expect(libraryImagesErrorField('tag must be at most 100 characters.')).toBe('tag');
  });

  it('names the description field for over-length descriptions', () => {
    expect(libraryImagesErrorField('description must be at most 500 characters.')).toBe('description');
  });

  it('names no field when the library is full', () => {
    expect(libraryImagesErrorField('Image library is full (10 images max).')).toBeUndefined();
  });

  it('falls back to the file field for file-content errors', () => {
    expect(libraryImagesErrorField('Only image files are accepted.')).toBe('file');
    expect(libraryImagesErrorField('At least one image file is required.')).toBe('file');
  });
});

describe('forwardLibraryImagesError', () => {
  it('tags a 400 with VALIDATION_FAILED and the failing field', async () => {
    const res = forwardLibraryImagesError(
      { error: 'tag must be at most 100 characters.', status: 400 },
      'POST /api/persona/images',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string; code?: string; field?: string };
    expect(body).toMatchObject({
      success: false,
      error: 'tag must be at most 100 characters.',
      code: 'VALIDATION_FAILED',
      field: 'tag',
    });
  });

  it('omits the field when the library is full', async () => {
    const res = forwardLibraryImagesError(
      { error: 'Image library is full (10 images max).', status: 400 },
      'POST /api/persona',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; field?: string };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBeUndefined();
  });

  it('forwards a 500 with its status and no validation code', async () => {
    const res = forwardLibraryImagesError(
      { error: 'Failed to add image.', status: 500 },
      'POST /api/persona/images',
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string; code?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to add image.');
    expect(body.code).toBeUndefined();
  });
});
