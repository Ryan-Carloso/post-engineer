import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '../[id]/route';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

const KEY_ID = '33333333-3333-4333-8333-333333333333';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const PERSONA_B = '22222222-2222-4222-8222-222222222222';

interface Fixture {
  existing: { id: string; revoked_at: string | null } | null;
  lookupError?: unknown;
  ownedPersonaIds?: string[];
  personaError?: unknown;
  updated?: Record<string, unknown> | null;
  updateError?: unknown;
}

function installSupabase(fixture: Fixture) {
  const update = vi.fn();
  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: fixture.updated ?? null,
      error: fixture.updateError ?? null,
    })),
  };
  update.mockReturnValue(updateChain);
  const personaIn = vi.fn(async () => ({
    data: (fixture.ownedPersonaIds ?? []).map((id) => ({ id })),
    error: fixture.personaError ?? null,
  }));
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return { select: () => ({ eq: () => ({ in: personaIn }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: fixture.existing, error: fixture.lookupError ?? null }),
            }),
          }),
        }),
        update,
      };
    }),
  };
  vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase as unknown as SupabaseClient);
  return { update, updateChain, personaIn };
}

let userCounter = 0;

function nextUserId(): string {
  userCounter += 1;
  return `user-${userCounter}`;
}

function sessionAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: nextUserId(), accessToken: 'token' },
    error: null,
  });
}

function call(body: unknown, id = KEY_ID, raw = false): Promise<Response> {
  return PATCH(
    new Request(`http://localhost:3434/api/api-keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function updatedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: KEY_ID,
    name: 'Agent',
    key_prefix: 'pe_live_12345678...',
    persona_ids: null,
    approval_mode: 'yolo',
    created_at: '2026-09-18T10:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('PATCH /api/api-keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionAuth();
  });

  it('changes the approval mode and returns the serialized key', async () => {
    const { update, updateChain } = installSupabase({
      existing: { id: KEY_ID, revoked_at: null },
      updated: updatedRow({ approval_mode: 'yolo' }),
    });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ approval_mode: 'yolo' });
    expect(updateChain.is).toHaveBeenCalledWith('revoked_at', null);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.key).toEqual({
      id: KEY_ID,
      name: 'Agent',
      keyPrefix: 'pe_live_12345678...',
      personaIds: null,
      approvalMode: 'yolo',
      createdAt: '2026-09-18T10:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it('scopes the key to owned personas', async () => {
    const { update, personaIn } = installSupabase({
      existing: { id: KEY_ID, revoked_at: null },
      ownedPersonaIds: [PERSONA_A],
      updated: updatedRow({ persona_ids: [PERSONA_A] }),
    });
    const response = await call({ personaIds: [PERSONA_A] });
    expect(response.status).toBe(200);
    expect(personaIn).toHaveBeenCalledWith('id', [PERSONA_A]);
    expect(update).toHaveBeenCalledWith({ persona_ids: [PERSONA_A] });
    expect((await response.json()).key.personaIds).toEqual([PERSONA_A]);
  });

  it('removes the persona scope when personaIds is null, without checking personas', async () => {
    const { update, personaIn } = installSupabase({
      existing: { id: KEY_ID, revoked_at: null },
      updated: updatedRow({ persona_ids: null }),
    });
    const response = await call({ personaIds: null, approvalMode: 'approval' });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ persona_ids: null, approval_mode: 'approval' });
    expect(personaIn).not.toHaveBeenCalled();
  });

  it('rejects personas that belong to another user with 400 and never updates', async () => {
    const { update } = installSupabase({
      existing: { id: KEY_ID, revoked_at: null },
      ownedPersonaIds: [PERSONA_A],
    });
    const response = await call({ personaIds: [PERSONA_A, PERSONA_B] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('only your own personas');
    expect(update).not.toHaveBeenCalled();
  });

  it('answers 500 and logs when the persona ownership query fails', async () => {
    const personaError = { message: 'db down' };
    const { update } = installSupabase({
      existing: { id: KEY_ID, revoked_at: null },
      personaError,
    });
    const response = await call({ personaIds: [PERSONA_A] });
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('persona ownership'), personaError);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown approvalMode', { approvalMode: 'sometimes' }],
    ['a null approvalMode', { approvalMode: null }],
    ['a non-array personaIds', { personaIds: PERSONA_A }],
    ['malformed persona ids', { personaIds: ['not-a-uuid'] }],
    ['an empty personaIds array', { personaIds: [] }],
    ['duplicate persona ids', { personaIds: [PERSONA_A, PERSONA_A] }],
    ['an empty object', {}],
    ['only unknown fields', { name: 'renamed' }],
    ['a JSON array body', []],
    ['a JSON null body', null],
  ])('rejects %s with 400 and never touches the database', async (_label, body) => {
    const { update } = installSupabase({ existing: { id: KEY_ID, revoked_at: null } });
    const response = await call(body);
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    installSupabase({ existing: { id: KEY_ID, revoked_at: null } });
    const response = await call('{nope', KEY_ID, true);
    expect(response.status).toBe(400);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a key id that is not a UUID with 400', async () => {
    installSupabase({ existing: null });
    const response = await call({ approvalMode: 'yolo' }, 'key-1');
    expect(response.status).toBe(400);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown or foreign key id', async () => {
    const { update } = installSupabase({ existing: null });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('answers 409 for a revoked key and never updates', async () => {
    const { update } = installSupabase({
      existing: { id: KEY_ID, revoked_at: '2026-09-19T10:00:00.000Z' },
    });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('answers 409 when the key is revoked between the lookup and the update', async () => {
    installSupabase({ existing: { id: KEY_ID, revoked_at: null }, updated: null });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(409);
  });

  it('answers 500 and logs the original error when the lookup fails', async () => {
    const lookupError = { message: 'boom' };
    installSupabase({ existing: null, lookupError });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('update lookup failed'), lookupError);
  });

  it('answers 500 and logs the original error when the update fails', async () => {
    const updateError = { message: 'boom' };
    installSupabase({ existing: { id: KEY_ID, revoked_at: null }, updateError });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('update failed'), updateError);
  });

  it('answers 401 when not authenticated', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 }) as unknown as NextResponse,
    });
    const response = await call({ approvalMode: 'yolo' });
    expect(response.status).toBe(401);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a persona-scoped API key',
      { userId: 'user-1', accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-scoped', personaIds: [PERSONA_A] },
    ],
    [
      'an unrestricted API key',
      { userId: 'user-1', accessToken: 'pe_live_full', isApiKey: true, keyId: 'key-full', personaIds: null },
    ],
    ['an OAuth token', { userId: 'user-1', accessToken: 'header.payload.signature', isOAuth: true }],
  ])('rejects %s with 403 so a key can never widen its own scope', async (_label, auth) => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { ...auth, userId: nextUserId() }, error: null });
    const response = await call({ personaIds: null });
    expect(response.status).toBe(403);
    expect((await response.json()).success).toBe(false);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/api-keys/[id] rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 429 after the apiKeyManage profile limit is exhausted for one user', async () => {
    vi.stubEnv('VERCEL', '1');
    const { RATE_LIMITS } = await import('@/lib/rate-limit');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: nextUserId(), accessToken: 'token' },
      error: null,
    });
    const headers = { 'Content-Type': 'application/json', 'x-vercel-forwarded-for': '10.250.0.9' };
    const send = (): Promise<Response> =>
      PATCH(
        new Request(`http://localhost:3434/api/api-keys/${KEY_ID}`, { method: 'PATCH', headers, body: '{}' }),
        { params: Promise.resolve({ id: KEY_ID }) },
      );
    for (let i = 0; i < RATE_LIMITS.apiKeyManage.limit; i++) {
      expect((await send()).status).toBe(400);
    }
    expect((await send()).status).toBe(429);
  });
});
