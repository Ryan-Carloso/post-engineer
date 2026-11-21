// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
const loggerWarn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, warn: loggerWarn } };
});

import { currentUserPromptVersion, ensureOfficialPromptVersion, readPostPromptFacts } from '@/lib/prompt-versions';
import { UserPromptStoreError } from '@/lib/user-prompts';

const VERSION = '7b0e6c1e-0000-4000-8000-000000000001';

interface Outcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

function tableDb(outcome: Outcome): { client: SupabaseClient; calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => outcome;
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function rpcDb(outcome: Outcome): { client: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(async () => outcome);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  loggerWarn.mockReset();
});

describe('currentUserPromptVersion', () => {
  it('reads the highest version of the prompt', async () => {
    const db = tableDb({ data: { id: VERSION, version: 4 }, error: null });
    expect(await currentUserPromptVersion(db.client, 'prompt-1')).toEqual({ versionId: VERSION, version: 4 });
    expect(db.calls).toEqual([
      ['from', 'prompt_versions'],
      ['select', 'id, version'],
      ['eq', 'prompt_id', 'prompt-1'],
      ['order', 'version', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('throws a store error on a read failure and when the prompt has no version', async () => {
    await expect(currentUserPromptVersion(tableDb({ data: null, error: { message: 'down' } }).client, 'p')).rejects.toBeInstanceOf(UserPromptStoreError);
    await expect(currentUserPromptVersion(tableDb({ data: null, error: null }).client, 'p')).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('ensureOfficialPromptVersion', () => {
  const official = { slug: 'daily-news', title: 'Daily news', prompt: 'Body' };

  it('records the official text through the RPC and reads its single row', async () => {
    const db = rpcDb({ data: [{ version_id: VERSION, version: 2 }], error: null });
    expect(await ensureOfficialPromptVersion(db.client, official)).toEqual({ versionId: VERSION, version: 2 });
    expect(db.rpc).toHaveBeenCalledWith('ensure_official_prompt_version', { p_slug: 'daily-news', p_title: 'Daily news', p_body: 'Body' });
  });

  it('accepts the row as a bare object too', async () => {
    const db = rpcDb({ data: { version_id: VERSION, version: 1 }, error: null });
    expect(await ensureOfficialPromptVersion(db.client, official)).toEqual({ versionId: VERSION, version: 1 });
  });

  it('throws a store error on an RPC error and on a malformed row', async () => {
    await expect(ensureOfficialPromptVersion(rpcDb({ data: null, error: { message: 'denied' } }).client, official)).rejects.toBeInstanceOf(UserPromptStoreError);
    await expect(ensureOfficialPromptVersion(rpcDb({ data: [{ version_id: VERSION }], error: null }).client, official)).rejects.toBeInstanceOf(UserPromptStoreError);
    await expect(ensureOfficialPromptVersion(rpcDb({ data: [], error: null }).client, official)).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('readPostPromptFacts', () => {
  it('returns null without a query for a post with no prompt version', async () => {
    const db = tableDb({ data: null, error: null });
    expect(await readPostPromptFacts(db.client, null)).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('returns the slug, title, number and source of the version', async () => {
    const db = tableDb({ data: { slug: 'calm-hook', title: 'Calm hook', version: 3, source: 'user' }, error: null });
    expect(await readPostPromptFacts(db.client, VERSION)).toEqual({ slug: 'calm-hook', title: 'Calm hook', version: 3, source: 'user' });
    expect(db.calls).toContainEqual(['eq', 'id', VERSION]);
  });

  it('returns null for a missing version and for an unknown source', async () => {
    expect(await readPostPromptFacts(tableDb({ data: null, error: null }).client, VERSION)).toBeNull();
    expect(await readPostPromptFacts(tableDb({ data: { slug: 's', title: 'T', version: 1, source: 'legacy' }, error: null }).client, VERSION)).toBeNull();
  });

  it('logs a failed read and leaves the detail page without the prompt', async () => {
    const result = await readPostPromptFacts(tableDb({ data: null, error: { code: '500', message: 'down' } }).client, VERSION);
    expect(result).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith('[prompt-versions] post prompt lookup failed', { versionId: VERSION, code: '500', message: 'down' });
  });
});
