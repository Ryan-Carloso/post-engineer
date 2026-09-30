//---------------
// apiErrorResponse — shared API error responder.
//
// Every Web API error (4xx and 5xx) flows through here so Bugsink gets
// enough context to debug, while clients only see safe messages.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(() => 'warn-log-id-123'),
    error: vi.fn(() => 'error-log-id-456'),
  },
}));

describe('apiErrorResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs 4xx as a warning (not an error) and returns the public message', async () => {
    const res = apiErrorResponse(400, 'personaId is required.', {
      route: 'POST /api/schedule',
      metadata: { personaId: 'abc-123' },
    });

    expect(res.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'personaId is required.',
      errorId: 'warn-log-id-123',
    });
  });

  it('logs 5xx as an error with the underlying cause', async () => {
    const cause = new Error('relation "schedules" does not exist');

    const res = apiErrorResponse(500, 'Failed to create schedule.', {
      route: 'POST /api/schedule',
      cause,
      metadata: { personaId: 'abc-123' },
    });

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();

    // The cause reaches the logger so Bugsink captures the real failure.
    const errorCall = vi.mocked(logger.error).mock.calls[0];
    expect(errorCall[1]).toBe(cause);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Failed to create schedule.',
      errorId: 'error-log-id-456',
    });
  });

  it('includes the route in the logged message for debuggability', () => {
    apiErrorResponse(404, 'Schedule not found.', { route: 'GET /api/schedule' });

    const warnCall = vi.mocked(logger.warn).mock.calls[0];
    expect(warnCall[0]).toContain('GET /api/schedule');
    expect(warnCall[1]).toMatchObject({ route: 'GET /api/schedule' });
  });

  it('redacts secret-bearing metadata keys instead of logging them raw', () => {
    apiErrorResponse(401, 'Unauthorized.', {
      route: 'GET /api/account',
      metadata: {
        authorization: 'Bearer super-secret-token',
        password: 'hunter2',
        appPassword: 'abcd-efgh',
        apiKey: 'sk-live-123',
        userId: 'user-789',
      },
    });

    const warnCall = vi.mocked(logger.warn).mock.calls[0];
    const loggedMetadata = warnCall[1] as Record<string, unknown>;

    expect(loggedMetadata['authorization']).toBe('[redacted]');
    expect(loggedMetadata['password']).toBe('[redacted]');
    expect(loggedMetadata['appPassword']).toBe('[redacted]');
    expect(loggedMetadata['apiKey']).toBe('[redacted]');

    // Safe keys pass through untouched.
    expect(loggedMetadata['userId']).toBe('user-789');

    // The raw secrets appear nowhere in the logged arguments.
    const serialized = JSON.stringify(warnCall);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abcd-efgh');
    expect(serialized).not.toContain('sk-live-123');
  });

  it('never lets telemetry break the response: a throwing logger still returns JSON', async () => {
    vi.mocked(logger.warn).mockImplementationOnce(() => {
      throw new Error('telemetry exploded');
    });

    const res = apiErrorResponse(400, 'Bad request.', { route: 'POST /api/schedule' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Bad request.');
    expect(typeof body.errorId).toBe('string');
  });

  it('works without options: defaults to an unknown route', async () => {
    const res = apiErrorResponse(500, 'Something broke.');

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(1);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorId).toBe('error-log-id-456');
  });

  it('merges extra fields into the response body and the logged metadata', async () => {
    const res = apiErrorResponse(400, 'Insufficient tokens.', {
      route: 'POST /api/schedule/batch',
      extra: { code: 'INSUFFICIENT', have: 10, need: 50 },
    });

    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: 'Insufficient tokens.',
      errorId: 'warn-log-id-123',
      code: 'INSUFFICIENT',
      have: 10,
      need: 50,
    });

    // Extra fields are also logged for debugging.
    const warnCall = vi.mocked(logger.warn).mock.calls[0];
    expect(warnCall[1]).toMatchObject({ code: 'INSUFFICIENT', have: 10, need: 50 });
  });
});
