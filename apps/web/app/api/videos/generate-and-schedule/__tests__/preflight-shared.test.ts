// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { budgetExpired, createPreflightShared, memoize, withBudget } from '../preflight-shared';

describe('memoize', () => {
  it('loads a key once and hands every caller the same pending result', async () => {
    const cache = new Map<string, Promise<number>>();
    const load = vi.fn(async () => 7);

    const first = memoize(cache, 'k', load);
    const second = memoize(cache, 'k', load);

    expect(second).toBe(first);
    expect(await first).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads each distinct key separately', async () => {
    const cache = new Map<string, Promise<string>>();
    const load = vi.fn(async () => 'v');

    await memoize(cache, 'a', load);
    await memoize(cache, 'b', load);

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('createPreflightShared', () => {
  it('starts with empty caches and a signal that fires after the budget', async () => {
    const shared = createPreflightShared(15);

    expect(shared.mediaChecks.size).toBe(0);
    expect(shared.narrations.size).toBe(0);
    expect(shared.signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(shared.signal.aborted).toBe(true);
  });
});

describe('withBudget', () => {
  it('keeps the local signal when there is no shared context', () => {
    const local = new AbortController().signal;

    expect(withBudget(local, undefined)).toBe(local);
  });

  it('aborts when the shared budget runs out', () => {
    const budget = new AbortController();
    const shared = { ...createPreflightShared(60_000), signal: budget.signal };
    const combined = withBudget(new AbortController().signal, shared);

    expect(combined.aborted).toBe(false);
    budget.abort();
    expect(combined.aborted).toBe(true);
  });

  it('aborts when the local timeout fires first', () => {
    const local = new AbortController();
    const combined = withBudget(local.signal, createPreflightShared(60_000));

    local.abort();

    expect(combined.aborted).toBe(true);
  });
});

describe('budgetExpired', () => {
  it('is false without a shared context and while the budget runs', () => {
    expect(budgetExpired(undefined)).toBe(false);
    expect(budgetExpired(createPreflightShared(60_000))).toBe(false);
  });

  it('is true once the shared budget signal aborted', () => {
    const budget = new AbortController();
    budget.abort();

    expect(budgetExpired({ ...createPreflightShared(60_000), signal: budget.signal })).toBe(true);
  });
});
