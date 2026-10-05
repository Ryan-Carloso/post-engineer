//---------------
// Route-level proof: handled 5xx responses from a real API route reach
// PostHog via withApiErrorReporting, while 4xx responses do not.
// Uses POST /api/billing/check-tokens because its 500 path (missing
// MONEYPRINT_API_SECRET) is deterministic without touching a database.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/billing/token-check', () => ({
  checkAndDeductTokens: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getPostHogServer } from '@/lib/posthog-server';
import { POST } from '@/app/api/billing/check-tokens/route';

const mockGetPostHogServer = vi.mocked(getPostHogServer);
const captureException = vi.fn();

function postRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/billing/check-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-engine-secret': 'test-secret',
      ...headers,
    },
    body: JSON.stringify({ userId: 'u1' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPostHogServer.mockReturnValue({
    capture: vi.fn(),
    captureAs: vi.fn(),
    captureException,
  });
  vi.stubEnv('NODE_ENV', 'production');
  process.env.MONEYPRINT_API_SECRET = 'test-secret';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/billing/check-tokens (PostHog 5xx reporting)', () => {
  it('reports the handled 500 to PostHog via captureException', async () => {
    delete process.env.MONEYPRINT_API_SECRET;

    const res = await POST(postRequest());

    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    const [error, properties] = captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error).toBeInstanceOf(Error);
    expect(properties).toMatchObject({
      route: 'POST /api/billing/check-tokens',
      status: 500,
    });
  });

  it('does not report the 401 to PostHog', async () => {
    const res = await POST(postRequest({ 'x-engine-secret': 'wrong' }));

    expect(res.status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(captureException).not.toHaveBeenCalled();
  });
});
