// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'err-id'), warn: vi.fn(() => 'warn-id'), info: vi.fn() },
}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

import { assertAccessActive } from '../access';
import { logger } from '@/lib/logger';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const CONTACT = 'https://wa.me/351962248268';
const DISCORD = 'https://discord.gg/ukmCXMCDJ';
const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeOptions {
  upsertError?: { message: string } | null;
  selectError?: { message: string } | null;
  accessUntil?: string;
  subscriptionStatus?: string | null;
}

function fakeClient(options: FakeOptions = {}) {
  const upsert = vi.fn(async () => ({ error: options.upsertError ?? null }));
  const eq = vi.fn(() => ({
    single: async () =>
      options.selectError
        ? { data: null, error: options.selectError }
        : {
          data: {
            access_until: options.accessUntil ?? '2026-11-25T12:00:00.000Z',
            subscription_status: options.subscriptionStatus ?? null,
          },
          error: null,
        },
  }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, upsert, select, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertAccessActive', () => {
  it('lets the action through while the access window is open', async () => {
    const fake = fakeClient({ accessUntil: '2026-11-21T12:00:00.000Z' });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result).toBeNull();
    expect(fake.upsert).toHaveBeenCalledWith({ id: 'user-1' }, { onConflict: 'id', ignoreDuplicates: true });
    expect(fake.select).toHaveBeenCalledWith('access_until,subscription_status');
    expect(fake.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it.each([8, 15, 30])('lets an admitted beta account through at day %i', async (day) => {
    const fake = fakeClient({ accessUntil: '2099-01-01T00:00:00.000Z', subscriptionStatus: 'beta' });
    const result = await assertAccessActive('user-1', {
      route: 'POST /x',
      supabase: fake.client,
      now: () => new Date(NOW.getTime() + day * DAY_MS),
    });
    expect(result).toBeNull();
  });

  it('lets a paid subscription through well past the window', async () => {
    const fake = fakeClient({ accessUntil: '2027-06-01T00:00:00.000Z', subscriptionStatus: 'active' });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result).toBeNull();
  });

  it('answers 402 BETA_ACCESS_REQUIRED with the Discord link for an account that has not joined the beta', async () => {
    const fake = fakeClient({ accessUntil: '2026-11-20T12:00:00.000Z' });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(402);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      code: 'BETA_ACCESS_REQUIRED',
      contactUrl: DISCORD,
      accessEndedAt: '2026-11-20T12:00:00.000Z',
      reason: 'beta',
    });
    expect(body.code).not.toBe('TRIAL_EXPIRED');
    expect(String(body.error)).toContain(DISCORD);
  });

  it('answers 402 BETA_ACCESS_REQUIRED when a beta admission was revoked', async () => {
    const fake = fakeClient({ accessUntil: '2026-11-20T12:00:00.000Z', subscriptionStatus: 'beta' });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(402);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'BETA_ACCESS_REQUIRED', contactUrl: DISCORD, reason: 'beta' });
  });

  it('answers 402 SUBSCRIPTION_INACTIVE when a cancelled subscription lapses', async () => {
    const fake = fakeClient({ accessUntil: '2026-11-20T12:00:00.000Z', subscriptionStatus: 'canceled' });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(402);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      code: 'SUBSCRIPTION_INACTIVE',
      contactUrl: CONTACT,
      accessEndedAt: '2026-11-20T12:00:00.000Z',
      reason: 'none',
    });
  });

  it('blocks with a 500 when the profile cannot be created', async () => {
    const fake = fakeClient({ upsertError: { message: 'upsert down' } });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(500);
    expect(fake.select).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[access] could not read the access window; blocking the action',
      expect.objectContaining({ message: 'access profile upsert failed: upsert down' }),
      { userId: 'user-1' },
    );
  });

  it('blocks with a 500 when the access window cannot be read', async () => {
    const fake = fakeClient({ selectError: { message: 'select down' } });
    const result = await assertAccessActive('user-1', { route: 'POST /x', supabase: fake.client, now: () => NOW });
    expect(result?.status).toBe(500);
    const body = (await result?.json()) as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      '[access] could not read the access window; blocking the action',
      expect.objectContaining({ message: 'access lookup failed: select down' }),
      { userId: 'user-1' },
    );
  });
});
