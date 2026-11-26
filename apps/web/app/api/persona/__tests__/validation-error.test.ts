import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(() => 'warn-id'), error: vi.fn(() => 'error-id'), info: vi.fn() },
}));

import { personaValidationError } from '../validation-error';
import { logger } from '@/lib/logger';

describe('personaValidationError', () => {
  it('returns a 400 with the VALIDATION_FAILED code and the field', async () => {
    const res = personaValidationError('name must be a string.', 'POST /api/persona', { field: 'name' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string; code: string; field: string };
    expect(body).toMatchObject({ success: false, error: 'name must be a string.', code: 'VALIDATION_FAILED', field: 'name' });
  });

  it('lets a caller-supplied code win', async () => {
    const res = personaValidationError('Persona not found.', 'PATCH /api/persona', { code: 'PERSONA_NOT_FOUND' });
    expect(((await res.json()) as { code: string }).code).toBe('PERSONA_NOT_FOUND');
  });

  it('logs the stable logMessage instead of the client message', () => {
    personaValidationError('Only image files are accepted. (image 2: doc.pdf)', 'POST /api/persona', {
      logMessage: 'Only image files are accepted.',
    });
    const message = String(vi.mocked(logger.warn).mock.calls.at(-1)?.[0]);
    expect(message).toBe('[POST /api/persona] 400 Only image files are accepted.');
  });
});


