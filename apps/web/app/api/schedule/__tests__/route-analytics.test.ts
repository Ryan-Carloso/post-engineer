// @vitest-environment node
// Analytics wiring tests: verify POST /api/schedule emits the expected
// PostHog events for each outcome. The helper itself is unit-tested in
// lib/__tests__/analytics.test.ts; these tests pin the wiring so a
// refactor cannot silently drop an event.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('@/lib/analytics', () => ({
  trackApiEvent: vi.fn(),
}));

import { POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-uuid-1';

function mockAuth(personaIds: string[] = [PERSONA_ID]) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'token', personaIds },
    error: null,
  } as never);
}

function mockRequest(body: unknown): Request {
  return new Request('http://localhost/api/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
    })),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
});

describe('POST /api/schedule analytics wiring', () => {
  it('emits schedule_request_failed with reason=invalid_json on bad JSON', async () => {
    mockAuth();
    const res = await POST(mockRequest('not-json{{{'));
    expect(res.status).toBe(400);
    expect(trackApiEvent).toHaveBeenCalledWith(
      'schedule_request_failed',
      expect.objectContaining({ reason: 'invalid_json' }),
    );
  });

  it('emits schedule_request_failed with reason=missing_personaId when absent', async () => {
    mockAuth();
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
    expect(trackApiEvent).toHaveBeenCalledWith(
      'schedule_request_failed',
      expect.objectContaining({ reason: 'missing_personaId' }),
    );
  });

  it('emits schedule_requested and schedule_request_failed when persona not allowed', async () => {
    mockAuth(['other-persona']);
    const res = await POST(mockRequest({ personaId: PERSONA_ID }));
    expect(res.status).toBe(403);
    expect(trackApiEvent).toHaveBeenCalledWith(
      'schedule_requested',
      expect.objectContaining({ personaId: PERSONA_ID }),
    );
    expect(trackApiEvent).toHaveBeenCalledWith(
      'schedule_request_failed',
      expect.objectContaining({ personaId: PERSONA_ID, reason: 'persona_not_allowed' }),
    );
  });
});
