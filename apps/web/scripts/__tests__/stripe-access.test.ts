import { describe, expect, it, vi } from 'vitest';
import { accessArgsOf, effectiveAccessOf, parseArgs, periodEndOf, run } from '../stripe-access.mjs';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    current_period_end: 1_800_000_000,
    metadata: { userId: 'user-1' },
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  };
}

function fakeSupabase(link: unknown = null, grantRows: { id: string }[] | null = [{ id: 'user-9' }]) {
  const calls: { table?: string; rpc?: string; args?: unknown; update?: unknown; upsert?: unknown }[] = [];
  return {
    calls,
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: link, error: null }) }) }),
        update: (values: unknown) => ({
          eq: async (_column: string, id: string) => {
            calls.push({ table, update: values, args: id });
            return { error: null };
          },
        }),
        upsert: (values: unknown, options: unknown) => ({
          select: async () => {
            calls.push({ table, upsert: values, args: options });
            return { data: grantRows, error: null };
          },
        }),
      };
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ rpc: name, args });
      return { error: null };
    },
  };
}

describe('stripe-access CLI', () => {
  it('parses grant, revoke and sync commands', () => {
    expect(parseArgs(['grant', '--email', 'a@b.c', '--until', '2027-01-01T00:00:00Z'])).toEqual({
      command: 'grant',
      email: 'a@b.c',
      until: '2027-01-01T00:00:00Z',
    });
    expect(parseArgs(['revoke', '--email', 'a@b.c'])).toEqual({ command: 'revoke', email: 'a@b.c', until: null });
    expect(parseArgs(['sync'])).toEqual({ command: 'sync', email: null, until: null });
  });

  it('rejects a grant without a valid --until and an unknown flag', () => {
    expect(() => parseArgs(['grant', '--email', 'a@b.c', '--until', 'tomorrow'])).toThrow(/ISO date/);
    expect(() => parseArgs(['grant', '--email', 'a@b.c'])).toThrow(/--until/);
    expect(() => parseArgs(['sync', '--nope'])).toThrow(/unknown argument/);
  });

  it('reads the paid-through date from the subscription items when Stripe omits it on the root', () => {
    expect(periodEndOf({ id: 'sub', items: { data: [{ current_period_end: 1_700_000_000 }, { current_period_end: 1_900_000_000 }] } })).toBe(
      new Date(1_900_000_000 * 1000).toISOString(),
    );
    expect(periodEndOf({ id: 'sub', current_period_end: 1_800_000_000 })).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(periodEndOf({ id: 'sub' })).toBeNull();
  });

  it('refuses a subscription with no customer or status instead of guessing', () => {
    expect(() => accessArgsOf({ id: 'sub', customer: null, status: 'active' })).toThrow(/customer/);
    expect(() => accessArgsOf({ id: 'sub', customer: 'cus_1', status: '' })).toThrow(/status/);
  });

  it('links an unlinked customer from subscription metadata before applying access', async () => {
    const supabase = fakeSupabase(null);
    const subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription();
        },
      }),
    };
    const result = await run(['sync'], { supabase, stripe: { subscriptions }, log: () => {} });
    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(supabase.calls[0]).toEqual({ rpc: 'link_stripe_customer', args: { p_user_id: 'user-1', p_customer_id: 'cus_1' } });
    expect(supabase.calls[1]).toMatchObject({
      rpc: 'apply_subscription_access',
      args: { p_customer_id: 'cus_1', p_status: 'active', p_current_period_end: new Date(1_800_000_000 * 1000).toISOString() },
    });
  });

  it('skips an unlinked subscription without metadata instead of assigning it to a random account', async () => {
    const supabase = fakeSupabase(null);
    const subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription({ metadata: {} });
        },
      }),
    };
    const result = await run(['sync'], { supabase, stripe: { subscriptions }, log: () => {} });
    expect(result).toEqual({ updated: 0, skipped: 1 });
    expect(supabase.calls).toEqual([]);
  });

  it('applies a cancellation through the same function', async () => {
    const supabase = fakeSupabase({ user_id: 'user-1' });
    const subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription({ status: 'canceled' });
        },
      }),
    };
    await run(['sync'], { supabase, stripe: { subscriptions }, log: () => {} });
    expect(supabase.calls[0]).toMatchObject({
      rpc: 'apply_subscription_access',
      args: { p_status: 'canceled' },
    });
  });

  it('maps each subscription status to the access the SQL function grants', () => {
    const now = new Date('2026-11-27T00:00:00Z');
    const future = { status: 'active', periodEnd: '2027-01-01T00:00:00.000Z', customer: 'cus_1', subscriptionId: 'sub_1', userId: null };
    expect(effectiveAccessOf(future, now)).toBe('2027-01-01T00:00:00.000Z');
    expect(effectiveAccessOf({ ...future, periodEnd: '2026-01-01T00:00:00.000Z' }, now)).toBe('2026-11-27T00:00:00.000Z');
    expect(effectiveAccessOf({ ...future, status: 'past_due' }, now)).toBe('2027-01-04T00:00:00.000Z');
    expect(effectiveAccessOf({ ...future, status: 'canceled' }, now)).toBe('2026-11-27T00:00:00.000Z');
    expect(() => effectiveAccessOf({ ...future, status: 'weird' }, now)).toThrow(/unknown subscription status/);
  });

  it('applies only the active subscription when a customer also holds a canceled one with a later paid-through date', async () => {
    const supabase = fakeSupabase({ user_id: 'user-1' });
    const subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription({ id: 'sub_old', status: 'canceled', current_period_end: 1_900_000_000, items: { data: [{ current_period_end: 1_900_000_000 }] } });
          yield subscription({ id: 'sub_new', status: 'active', current_period_end: 1_800_000_000, items: { data: [{ current_period_end: 1_800_000_000 }] } });
        },
      }),
    };
    const now = () => new Date('2026-11-27T00:00:00Z');
    const result = await run(['sync'], { supabase, stripe: { subscriptions }, log: () => {}, now });
    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0]).toMatchObject({
      rpc: 'apply_subscription_access',
      args: { p_subscription_id: 'sub_new', p_status: 'active' },
    });
  });

  it('applies the later paid-through date when a customer holds two active subscriptions', async () => {
    const supabase = fakeSupabase({ user_id: 'user-1' });
    const subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield subscription({ id: 'sub_early', status: 'active', current_period_end: 1_800_000_000, items: { data: [{ current_period_end: 1_800_000_000 }] } });
          yield subscription({ id: 'sub_late', status: 'active', current_period_end: 1_900_000_000, items: { data: [{ current_period_end: 1_900_000_000 }] } });
        },
      }),
    };
    const now = () => new Date('2026-11-27T00:00:00Z');
    const result = await run(['sync'], { supabase, stripe: { subscriptions }, log: () => {}, now });
    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(supabase.calls).toHaveLength(1);
    expect(supabase.calls[0]).toMatchObject({
      rpc: 'apply_subscription_access',
      args: { p_subscription_id: 'sub_late', p_status: 'active', p_current_period_end: new Date(1_900_000_000 * 1000).toISOString() },
    });
  });

  it('grants access by writing access_until for the matched email', async () => {
    const supabase = fakeSupabase();
    const admin = {
      listUsers: async () => ({ data: { users: [{ id: 'user-9', email: 'A@B.c' }] }, error: null }),
    };
    const granted = await run(['grant', '--email', 'a@b.c', '--until', '2027-01-01T00:00:00Z'], {
      supabase: { ...supabase, auth: { admin } },
      log: () => {},
    });
    expect(granted).toEqual({ updated: 1 });
    expect(supabase.calls[0]).toEqual({
      table: 'user_profiles',
      upsert: { id: 'user-9', access_until: '2027-01-01T00:00:00.000Z' },
      args: { onConflict: 'id' },
    });
  });

  it('fails loudly when the grant upsert returns no row', async () => {
    const supabase = fakeSupabase(null, []);
    const admin = {
      listUsers: async () => ({ data: { users: [{ id: 'user-9', email: 'a@b.c' }] }, error: null }),
    };
    await expect(
      run(['grant', '--email', 'a@b.c', '--until', '2027-01-01T00:00:00Z'], {
        supabase: { ...supabase, auth: { admin } },
        log: () => {},
      }),
    ).rejects.toThrow(/no profile for a@b\.c/);
    expect(supabase.calls[0]).toMatchObject({
      table: 'user_profiles',
      upsert: { id: 'user-9', access_until: '2027-01-01T00:00:00.000Z' },
    });
  });

  it('fails loudly when no user matches the email', async () => {
    const supabase = { ...fakeSupabase(), auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } };
    await expect(run(['revoke', '--email', 'nobody@b.c'], { supabase, log: () => {} })).rejects.toThrow(/no user with email/);
  });

  it('revokes through the SQL function', async () => {
    const supabase = fakeSupabase();
    const admin = { listUsers: async () => ({ data: { users: [{ id: 'user-9', email: 'a@b.c' }] }, error: null }) };
    const now = () => new Date('2026-11-27T00:00:00Z');
    const log = vi.fn();
    await run(['revoke', '--email', 'a@b.c'], { supabase: { ...supabase, auth: { admin } }, log, now });
    expect(supabase.calls[0]).toEqual({ rpc: 'revoke_access', args: { p_user_id: 'user-9' } });
    expect(log).toHaveBeenCalledWith('revoked a@b.c at 2026-11-27T00:00:00.000Z');
  });
});
