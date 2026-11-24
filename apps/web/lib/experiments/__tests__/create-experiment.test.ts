// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { createExperiment } from '../create-experiment';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PERSONA = '33333333-3333-4333-8333-333333333333';

interface InsertedRow { [key: string]: unknown }

function body(): CreateExperimentBody {
  const videos = (prefix: string) => [1, 2, 3, 4, 5].map((n) => ({ title: `${prefix}${n}`, description: `d ${prefix}${n}` }));
  return {
    name: 'Hook test',
    personaId: PERSONA,
    videoType: 'voiceover',
    prompts: [
      { promptVersionId: A, videos: videos('a') },
      { promptVersionId: B, videos: videos('b') },
    ],
    videosPerPrompt: 5,
    postsPerDay: 2,
    providers: ['youtube'],
    accounts: { youtube: ['yt-1'] },
    startAt: '2026-12-01T00:00:00',
    times: ['09:00', '18:00'],
    timezone: 'UTC',
  };
}

function fakeDb(spend: unknown = { spent: true, balance: 100 }): {
  client: SupabaseClient;
  inserted: Record<string, InsertedRow[]>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const inserted: Record<string, InsertedRow[]> = {};
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.order = () => chain;
      chain.single = async () => {
        if (table === 'personas') return { data: { id: PERSONA, face_quality: 'ok' }, error: null };
        return { data: null, error: { code: 'PGRST116' } };
      };
      chain.insert = (rows: InsertedRow | InsertedRow[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        inserted[table] = [...(inserted[table] ?? []), ...list];
        const insertChain: Record<string, unknown> = {};
        insertChain.select = async () => ({
          data: list.map((row, index) => ({ id: `slot-${index}`, slot_at: row.slot_at, title: row.title, prompt_version_id: row.prompt_version_id })),
          error: null,
        });
        insertChain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
        return insertChain;
      };
      chain.delete = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => {
        const data = table === 'prompt_versions'
          ? [
            { id: A, owner_id: 'user-1', source: 'user' },
            { id: B, owner_id: 'user-1', source: 'user' },
          ]
          : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'spend_tokens') return { data: spend, error: null };
      return { data: { refunded: true }, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, inserted, rpcCalls };
}

describe('createExperiment', () => {
  it('charges once for the whole sample and creates interleaved pending slots', async () => {
    const db = fakeDb();
    const outcome = await createExperiment(db.client, 'user-1', body());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.totalVideos).toBe(10);
    expect(outcome.value.totalTokens).toBe(10);
    expect(db.rpcCalls.filter((call) => call.fn === 'spend_tokens')).toEqual([
      { fn: 'spend_tokens', args: expect.objectContaining({ p_amount: 10, p_generation_id: expect.stringContaining('batch:') }) },
    ]);
    const slots = db.inserted.scheduled_posts ?? [];
    expect(slots).toHaveLength(10);
    expect(slots.map((slot) => slot.prompt_version_id)).toEqual([A, B, A, B, A, B, A, B, A, B]);
    expect(slots.every((slot) => slot.status === 'pending' && slot.experiment_id === outcome.value.experimentId)).toBe(true);
    expect(db.inserted.experiments).toHaveLength(1);
    expect(db.inserted.schedules).toHaveLength(10);
  });

  it('refuses when tokens are insufficient and creates nothing', async () => {
    const db = fakeDb({ spent: false, balance: 3 });
    const outcome = await createExperiment(db.client, 'user-1', body());
    expect(outcome).toMatchObject({ ok: false, status: 402, need: 10, have: 3 });
    expect(db.inserted.experiments ?? []).toHaveLength(0);
    expect(db.inserted.scheduled_posts ?? []).toHaveLength(0);
  });
});
