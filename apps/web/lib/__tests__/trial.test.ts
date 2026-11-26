// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'err-id'), warn: vi.fn(() => 'warn-id'), info: vi.fn() },
}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

import { assertTrialActive } from '../trial';
import { logger } from '@/lib/logger';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const CONTACT = 'https://wa.me/000000000';

interface FakeOptions {
  upsertError?: { message: string } | null;
  selectError?: { message: string } | null;
  trialEndsAt?: string;
}

function fakeClient(options: FakeOptions = {}) {
  const upsert = vi.fn(async () => ({ error: options.upsertError ?? null }));
  const eq = vi.fn(() => ({
    single: async () =>
      options.selectError
        ? { data: null, error: options.selectError }
        : { data: { trial_ends_at: options.trialEndsAt ?? '2026-11-25T12:00:00.000Z' }, error: null },
  }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, upsert, select, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_CONTACT_WHATSAPP_URL', CONTACT);
});

describe('assertTrialActive', () => {
  it('lets the action through while the trial is running', async () => {
    const fake = fakeClient({ trialEndsAt: '2026-11-21T12:00:00.000Z' });
    const result = await assertTrialActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result).toBeNull();
    expect(fake.upsert).toHaveBeenCalledWith({ id: 'user-1' }, { onConflict: 'id', ignoreDuplicates: true });
    expect(fake.select).toHaveBeenCalledWith('trial_ends_at');
    expect(fake.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('answers 402 TRIAL_EXPIRED with the contact link once the trial has ended', async () => {
    const fake = fakeClient({ trialEndsAt: '2026-11-20T12:00:00.000Z' });
    const result = await assertTrialActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(402);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      code: 'TRIAL_EXPIRED',
      contactUrl: CONTACT,
      trialEndedAt: '2026-11-20T12:00:00.000Z',
    });
  });

  it('blocks with a 500 when the trial profile cannot be created', async () => {
    const fake = fakeClient({ upsertError: { message: 'upsert down' } });
    const result = await assertTrialActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(500);
    expect(fake.select).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[trial] could not read the trial window; blocking the action',
      expect.objectContaining({ message: 'trial profile upsert failed: upsert down' }),
      { userId: 'user-1' },
    );
  });

  it('blocks with a 500 when the trial window cannot be read', async () => {
    const fake = fakeClient({ selectError: { message: 'select down' } });
    const result = await assertTrialActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(500);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      '[trial] could not read the trial window; blocking the action',
      expect.objectContaining({ message: 'trial lookup failed: select down' }),
      { userId: 'user-1' },
    );
  });
});
