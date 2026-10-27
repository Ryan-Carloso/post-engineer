//---------------
// Tests for POST /api/videos/validate-script.
//
// Mechanical validation only: no token debit, no schedule, no engine or
// Modal call. The route imports no Supabase service client and no engine
// client; the source-shape test below pins that boundary.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../validate-script/route';
import { requireSupabaseSession } from '@/lib/request-auth';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
const segments = [
  { kind: 'hook', text: hook },
  { kind: 'body', text: body },
  { kind: 'cta', text: cta },
];

function authRequest(payload: unknown): Request {
  return new Request('https://post-engineer.com/api/videos/validate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
});

describe('POST /api/videos/validate-script', () => {
  it('accepts a valid script and reports counts, the 8-12s hook window and pending measured duration', async () => {
    const response = await POST(authRequest({ segments }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.segmentCount).toBe(3);
    expect(payload.totalWords).toBe(75);
    expect(payload.hookWords).toBe(24);
    expect(payload.bodyWords).toBe(42);
    expect(payload.ctaWords).toBe(9);
    expect(payload.hookWindowSeconds).toEqual({ min: 8, max: 12 });
    // Measured duration is pending, never invented.
    expect(payload.measuredDurationSeconds).toBeNull();
    expect(payload.measured).toBe('pending');
    expect(typeof payload.measuredReason).toBe('string');
    expect(payload.measuredReason as string).toContain('hook-only TTS');
  });

  it('rejects an invalid script with 400 carrying field, rule and fix', async () => {
    const bad = [
      { kind: 'body', text: body },
      { kind: 'hook', text: hook },
      { kind: 'cta', text: cta },
    ];
    const response = await POST(authRequest({ segments: bad }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(false);
    expect(typeof payload.field).toBe('string');
    expect(typeof payload.rule).toBe('string');
    expect(typeof payload.fix).toBe('string');
    expect(payload.field as string).toContain('segments');
  });

  it('rejects unauthenticated callers before validating', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(authRequest({ segments }));
    expect(response.status).toBe(401);
  });

  it('never debits tokens, schedules or calls the engine: the route source has no such boundary', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/app/api/videos/validate-script/route.ts'), 'utf8');
    expect(source).not.toContain('spend_tokens');
    expect(source).not.toContain('scheduled_posts');
    expect(source).not.toContain('createSupabaseServiceClient');
    expect(source).not.toContain('startEngineVideoTask');
    expect(source).not.toContain('generation/video-generation');
    expect(source).not.toContain('from \'@/lib/engine');
  });
});
