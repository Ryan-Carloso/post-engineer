// @vitest-environment node
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readPromptComparison = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());
const quoteExperiment = vi.hoisted(() => vi.fn());
const confirmExperiment = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ marker: 'db' })) }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/experiments/read-comparison', () => ({ readPromptComparison }));
vi.mock('../create-quote', () => ({ quoteExperiment }));
vi.mock('../create-confirm', () => ({ confirmExperiment }));
vi.mock('../create-plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../create-plan')>();
  return { ...actual, parseExperimentRequest: vi.fn(actual.parseExperimentRequest) };
});
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, error: loggerError } };
});
vi.mock('@/lib/api-error-reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-error-reporting')>()),
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));

import { GET, POST } from '../route';
import { parseExperimentRequest } from '../create-plan';
import { experimentBody } from './create-fixtures';
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

function post(body: unknown): Promise<Response> {
  return POST(new Request('https://post-engineer.test/api/experiments', { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/experiments', () => {
  beforeEach(() => {
    quoteExperiment.mockReset();
    confirmExperiment.mockReset();
    quoteExperiment.mockResolvedValue(NextResponse.json({ stage: 'quote' }));
    confirmExperiment.mockResolvedValue(NextResponse.json({ stage: 'confirmed' }));
  });

  it('answers a body without a quote key with a quote and never confirms', async () => {
    const response = await post(experimentBody());

    expect(await response.json()).toEqual({ stage: 'quote' });
    expect(quoteExperiment).toHaveBeenCalledTimes(1);
    expect(confirmExperiment).not.toHaveBeenCalled();
    expect(quoteExperiment.mock.calls[0]?.[0]).toEqual({ marker: 'db' });
    expect(quoteExperiment.mock.calls[0]?.[1]).toMatchObject({ userId: 'user-1' });
  });

  it('confirms when the body carries the quote key and its expiry', async () => {
    const response = await post({ ...experimentBody(), quoteKey: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' });

    expect(await response.json()).toEqual({ stage: 'confirmed' });
    expect(confirmExperiment).toHaveBeenCalledTimes(1);
    expect(quoteExperiment).not.toHaveBeenCalled();
  });

  it('hands an API key caller to the handlers with its persona scope', async () => {
    signedIn({ isApiKey: true, personaIds: [PERSONA] });

    await post(experimentBody());

    expect(quoteExperiment.mock.calls[0]?.[1]).toMatchObject({ isApiKey: true, personaIds: [PERSONA] });
  });

  it('rate limits per user with the experimentCreate profile, then parses the body on the normal path', async () => {
    vi.mocked(parseExperimentRequest).mockClear();

    await post(experimentBody());

    expect(parseExperimentRequest).toHaveBeenCalledTimes(1);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.experimentCreate, 'user-1');
  });

  it('returns the rate-limit response before the body is parsed', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'slow down' }, { status: 429 }));
    vi.mocked(parseExperimentRequest).mockClear();

    const response = await post(experimentBody());

    expect(response.status).toBe(429);
    expect(parseExperimentRequest).not.toHaveBeenCalled();
    expect(quoteExperiment).not.toHaveBeenCalled();
    expect(confirmExperiment).not.toHaveBeenCalled();
  });

  it('rejects an expiresAt without a quoteKey with 400 instead of quoting', async () => {
    const response = await post({ ...experimentBody(), expiresAt: '2030-01-01T00:00:00.000Z' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'quoteKey' });
    expect(quoteExperiment).not.toHaveBeenCalled();
    expect(confirmExperiment).not.toHaveBeenCalled();
  });

  it('rejects a quoteKey without an expiresAt with 400 instead of confirming', async () => {
    const response = await post({ ...experimentBody(), quoteKey: 'a'.repeat(64) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'quoteKey' });
    expect(quoteExperiment).not.toHaveBeenCalled();
    expect(confirmExperiment).not.toHaveBeenCalled();
  });

  it('answers the auth error unchanged', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: NextResponse.json({ error: 'no' }, { status: 401 }) } as never);

    const response = await post(experimentBody());

    expect(response.status).toBe(401);
    expect(quoteExperiment).not.toHaveBeenCalled();
  });

  it('rejects a body that breaks the contract with 400 before any handler', async () => {
    const response = await post({ ...experimentBody(), surprise: true });

    expect(response.status).toBe(400);
    expect(quoteExperiment).not.toHaveBeenCalled();
    expect(confirmExperiment).not.toHaveBeenCalled();
  });
});
