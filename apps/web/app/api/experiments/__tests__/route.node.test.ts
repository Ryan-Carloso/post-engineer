import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readPromptComparison = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ marker: 'db' })) }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/experiments/read-comparison', () => ({ readPromptComparison }));
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, error: loggerError } };
});
vi.mock('@/lib/api-error-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-error-reporting')>()),
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));

import { GET } from '../route';
import { PromptComparisonResponseSchema } from '@/lib/contracts/experiments';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

const PERSONA = '11111111-2222-4333-8444-555555555555';

function get(query = ''): Promise<Response> {
  return GET(new Request(`https://post-engineer.test/api/experiments${query}`));
}

function signedIn(extra: Record<string, unknown> = {}): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: 'user-1', accessToken: 't', ...extra }, error: null } as never);
}

beforeEach(() => {
  readPromptComparison.mockReset();
  readPromptComparison.mockResolvedValue({ ok: true, value: { window: '7d', accounts: [], truncated: false } });
  loggerError.mockReset();
  vi.mocked(applyRateLimit).mockClear();
  signedIn();
});

describe('GET /api/experiments', () => {
  it('compares the caller prompts for the default 7d window, unscoped', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(PromptComparisonResponseSchema.safeParse(body).success).toBe(true);
    expect(readPromptComparison).toHaveBeenCalledWith({ marker: 'db' }, { userId: 'user-1', window: '7d', personaIds: null });
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.experimentRead, 'user-1');
  });

  it('passes a requested window through', async () => {
    await get('?window=28d');
    expect(readPromptComparison.mock.calls[0]?.[1]).toMatchObject({ window: '28d' });
  });

  it('scopes a persona-scoped key to its well-formed persona ids', async () => {
    signedIn({ isApiKey: true, personaIds: [PERSONA, 'not-a-uuid'] });
    await get();
    expect(readPromptComparison.mock.calls[0]?.[1]).toMatchObject({ personaIds: [PERSONA] });
  });

  it('rejects an unknown window and an unknown parameter with 400 before any read', async () => {
    const badWindow = await get('?window=30d');
    const unknown = await get('?persona=x');
    expect(badWindow.status).toBe(400);
    expect(await badWindow.json()).toMatchObject({ code: 'VALIDATION_FAILED', error: 'window must be one of 24h, 7d, 28d.' });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: 'Unknown query parameter.' });
    expect(readPromptComparison).not.toHaveBeenCalled();
  });

  it('answers the auth error unchanged', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: NextResponse.json({ success: false }, { status: 401 }) } as never);
    const response = await get();
    expect(response.status).toBe(401);
    expect(readPromptComparison).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }));
    const response = await get();
    expect(response.status).toBe(429);
    expect(readPromptComparison).not.toHaveBeenCalled();
  });

  it('logs a failed read and answers 500 INTERNAL_ERROR', async () => {
    const cause = { message: 'db down' };
    readPromptComparison.mockResolvedValueOnce({ ok: false, cause });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
    expect(loggerError).toHaveBeenCalledWith('[GET /api/experiments] 500 Failed to load the prompt comparison.', cause, expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });
});
