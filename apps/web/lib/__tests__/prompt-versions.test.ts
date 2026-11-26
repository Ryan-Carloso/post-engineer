// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { currentUserPromptVersion } from '@/lib/prompt-versions';
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
