import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error: (...args: unknown[]) => loggerError(...args) } }));

import { checkPromptVersion } from '../prompt-version';

const USER = 'user-1';
const VERSION = '7b0e6c1e-0000-4000-8000-000000000001';
const PROMPT = '7b0e6c1e-0000-4000-8000-0000000000aa';

interface Outcome {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

function fakeDb(tables: Record<string, Outcome>): { client: SupabaseClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      const chain = {
        select(columns: string) {
          calls.push(`${table}:select ${columns}`);
          return chain;
        },
        eq(column: string, value: string) {
          calls.push(`${table}:eq ${column}=${value}`);
          return chain;
        },
        maybeSingle: async (): Promise<Outcome> => tables[table] ?? { data: null, error: null },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function version(fields: Record<string, unknown>): Outcome {
  return { data: { id: VERSION, source: 'user', owner_id: 'someone-else', prompt_id: PROMPT, ...fields }, error: null };
}

describe('checkPromptVersion', () => {
  beforeEach(() => {
    loggerError.mockReset();
  });

  it('accepts an official version without reading user_prompts', async () => {
    const db = fakeDb({ prompt_versions: version({ source: 'official', owner_id: null, prompt_id: null }) });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('ok');
    expect(db.calls).toEqual(['prompt_versions:select id, source, owner_id, prompt_id', `prompt_versions:eq id=${VERSION}`]);
  });

  it('accepts the caller\'s own version, even after the prompt was deleted', async () => {
    const db = fakeDb({ prompt_versions: version({ owner_id: USER, prompt_id: null }) });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('ok');
  });

  it('treats an own private version as unreadable for a persona-scoped key', async () => {
    const db = fakeDb({
      prompt_versions: version({ owner_id: USER }),
      user_prompts: { data: { visibility: 'private' }, error: null },
    });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: false })).toBe('not_found');
    expect(db.calls).toContain(`user_prompts:eq id=${PROMPT}`);
  });

  it('accepts another user\'s version while its prompt is public', async () => {
    const db = fakeDb({ prompt_versions: version({}), user_prompts: { data: { visibility: 'public' }, error: null } });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('ok');
  });

  it('rejects another user\'s version once its prompt is private or deleted', async () => {
    const privateDb = fakeDb({ prompt_versions: version({}), user_prompts: { data: { visibility: 'private' }, error: null } });
    expect(await checkPromptVersion(privateDb.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('not_found');
    const goneDb = fakeDb({ prompt_versions: version({}), user_prompts: { data: null, error: null } });
    expect(await checkPromptVersion(goneDb.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('not_found');
    const unlinkedDb = fakeDb({ prompt_versions: version({ prompt_id: null }) });
    expect(await checkPromptVersion(unlinkedDb.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('not_found');
    expect(unlinkedDb.calls.some((call) => call.startsWith('user_prompts'))).toBe(false);
  });

  it('rejects an unknown version', async () => {
    const db = fakeDb({});
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('not_found');
  });

  it('logs and reports a failed version lookup', async () => {
    const error = { message: 'boom' };
    const db = fakeDb({ prompt_versions: { data: null, error } });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('error');
    expect(loggerError).toHaveBeenCalledWith('[generate-and-schedule] prompt version lookup failed', error, { versionId: VERSION });
  });

  it('logs and reports a failed visibility lookup', async () => {
    const error = { message: 'boom' };
    const db = fakeDb({ prompt_versions: version({}), user_prompts: { data: null, error } });
    expect(await checkPromptVersion(db.client, { versionId: VERSION, userId: USER, allowOwn: true })).toBe('error');
    expect(loggerError).toHaveBeenCalledWith('[generate-and-schedule] prompt visibility lookup failed', error, { versionId: VERSION });
  });
});
