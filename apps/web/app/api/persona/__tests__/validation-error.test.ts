import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(() => 'warn-id'), error: vi.fn(() => 'error-id'), info: vi.fn() },
}));

import { personaValidationError } from '../validation-error';
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
