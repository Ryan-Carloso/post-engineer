// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
const loggerWarn = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, warn: loggerWarn, error: loggerError } };
});

import { currentUserPromptVersion, readPostPromptFacts } from '@/lib/prompt-versions';
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

beforeEach(() => {
  loggerWarn.mockReset();
  loggerError.mockReset();
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

describe('readPostPromptFacts', () => {
  it('returns the slug, title, number and source of the version', async () => {
    const db = tableDb({ data: { slug: 'calm-hook', title: 'Calm hook', version: 3, source: 'user' }, error: null });
    expect(await readPostPromptFacts(db.client, VERSION)).toEqual({ slug: 'calm-hook', title: 'Calm hook', version: 3, source: 'user' });
    expect(db.calls).toContainEqual(['eq', 'id', VERSION]);
  });

  it('returns null and logs at error level when the version row is missing', async () => {
    expect(await readPostPromptFacts(tableDb({ data: null, error: null }).client, VERSION)).toBeNull();
    expect(loggerError).toHaveBeenCalledWith('[prompt-versions] post prompt version missing', expect.any(Error), { versionId: VERSION });
  });

  it('returns null for an unknown source', async () => {
    expect(await readPostPromptFacts(tableDb({ data: { slug: 's', title: 'T', version: 1, source: 'legacy' }, error: null }).client, VERSION)).toBeNull();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('logs a failed read at error level and leaves the detail page without the prompt', async () => {
    const error = { code: '42501', message: 'permission denied for table prompt_versions' };
    const result = await readPostPromptFacts(tableDb({ data: null, error }).client, VERSION);
    expect(result).toBeNull();
    expect(loggerError).toHaveBeenCalledWith('[prompt-versions] post prompt lookup failed', error, { versionId: VERSION, code: '42501' });
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});
