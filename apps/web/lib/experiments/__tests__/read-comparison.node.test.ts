import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { COMPARISON_ROW_LIMIT } from '../comparison-limits';
import { readPromptComparison } from '../read-comparison';

const A = '11111111-1111-4111-8111-111111111111';

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

function fakeDb(results: Record<string, { data: unknown; error: unknown }>): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve);
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function row(views: number | null, promptVersionId: string | null, accountId = 'yt-1'): Record<string, unknown> {
  return { provider: 'youtube', account_id: accountId, views, prompt_version_id: promptVersionId };
}

describe('readPromptComparison', () => {
  it('reads the user window, newest first, one row past the cap, then the referenced versions only', async () => {
    const db = fakeDb({
      post_metrics: { data: [row(100, A), row(50, null), row(null, A)], error: null },
      prompt_versions: { data: [{ id: A, slug: 'calm-hook', title: 'Calm hook', version: 2, source: 'user' }], error: null },
    });
    const outcome = await readPromptComparison(db.client, { userId: 'user-1', window: '28d', personaIds: null });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.window).toBe('28d');
    expect(outcome.value.truncated).toBe(false);
    expect(outcome.value.accounts[0]?.videos).toBe(2);
    expect(outcome.value.accounts[0]?.prompts[0]).toMatchObject({ versionId: A, title: 'Calm hook', version: 2, videos: 1 });
    expect(db.calls.filter((call) => call.table === 'post_metrics').map((call) => [call.method, ...call.args])).toEqual([
      ['select', 'provider, account_id, views, prompt_version_id'],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'metrics_window', '28d'],
      ['order', 'collected_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
      ['limit', COMPARISON_ROW_LIMIT + 1],
    ]);
    expect(db.calls.find((call) => call.table === 'prompt_versions' && call.method === 'in')?.args).toEqual(['id', [A]]);
  });

  it('limits a persona-scoped key to its personas', async () => {
    const db = fakeDb({ post_metrics: { data: [], error: null } });
    await readPromptComparison(db.client, { userId: 'user-1', window: '7d', personaIds: ['p-1'] });
    expect(db.calls.find((call) => call.method === 'in')?.args).toEqual(['persona_id', ['p-1']]);
  });

  it('answers an empty comparison for a scoped key with no persona, without any query', async () => {
    const db = fakeDb({});
    const outcome = await readPromptComparison(db.client, { userId: 'user-1', window: '7d', personaIds: [] });
    expect(outcome).toEqual({ ok: true, value: { window: '7d', accounts: [], truncated: false } });
    expect(db.calls).toEqual([]);
  });

  it('reports truncation and compares only the capped rows', async () => {
    const rows = Array.from({ length: COMPARISON_ROW_LIMIT + 1 }, () => row(10, A));
    const db = fakeDb({ post_metrics: { data: rows, error: null }, prompt_versions: { data: [], error: null } });
    const outcome = await readPromptComparison(db.client, { userId: 'user-1', window: '7d', personaIds: null });
    expect(outcome.ok && outcome.value.truncated).toBe(true);
    expect(outcome.ok && outcome.value.accounts[0]?.videos).toBe(COMPARISON_ROW_LIMIT);
  });

  it('skips the version read when no video names a prompt', async () => {
    const db = fakeDb({ post_metrics: { data: [row(10, null)], error: null } });
    const outcome = await readPromptComparison(db.client, { userId: 'user-1', window: '7d', personaIds: null });
    expect(outcome).toEqual({ ok: true, value: { window: '7d', accounts: [], truncated: false } });
    expect(db.calls.some((call) => call.table === 'prompt_versions')).toBe(false);
  });

  it('drops a version row with an unknown source', async () => {
    const db = fakeDb({
      post_metrics: { data: [row(10, A)], error: null },
      prompt_versions: { data: [{ id: A, slug: 's', title: 'T', version: 1, source: 'legacy' }], error: null },
    });
    const outcome = await readPromptComparison(db.client, { userId: 'user-1', window: '7d', personaIds: null });
    expect(outcome.ok && outcome.value.accounts[0]?.prompts[0]).toMatchObject({ versionId: A, title: null });
  });

  it('returns the cause of a failed metrics read and of a failed version read', async () => {
    const metricsError = { message: 'metrics down' };
    const failedMetrics = await readPromptComparison(fakeDb({ post_metrics: { data: null, error: metricsError } }).client, { userId: 'u', window: '7d', personaIds: null });
    expect(failedMetrics).toEqual({ ok: false, cause: metricsError });
    const versionsError = { message: 'versions down' };
    const failedVersions = await readPromptComparison(
      fakeDb({ post_metrics: { data: [row(10, A)], error: null }, prompt_versions: { data: null, error: versionsError } }).client,
      { userId: 'u', window: '7d', personaIds: null },
    );
    expect(failedVersions).toEqual({ ok: false, cause: versionsError });
  });
});
