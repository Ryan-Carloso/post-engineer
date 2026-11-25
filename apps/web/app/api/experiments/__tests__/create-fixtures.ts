import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import type { SupabaseSessionAuth } from '@/lib/request-auth';

export const USER_ID = 'user-1';
export const VERSION_A = '11111111-1111-4111-8111-111111111111';
export const VERSION_B = '22222222-2222-4222-8222-222222222222';
export const VERSION_C = '33333333-3333-4333-8333-333333333333';

export const AUTH: SupabaseSessionAuth = { userId: USER_ID, accessToken: 'token', isApiKey: false, personaIds: null };

const HOOK =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
const CONTENT =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const CTA_TAKE = 'Save this video before your next trip to Porto.';

export function segmentsFor(): NonNullable<CreateExperimentBody['variants'][number]['videos'][number]['segments']> {
  return [
    { kind: 'hook', text: HOOK, media: [0, 1, 2, 3, 4].map((photo) => ({ url: `https://e.com/h${photo}.jpg` })) },
    { kind: 'content', text: CONTENT, media: [0, 1, 2, 3, 4, 5, 6, 7].map((photo) => ({ url: `https://e.com/b${photo}.jpg` })) },
    { kind: 'content', text: CTA_TAKE, media: [0, 1].map((photo) => ({ url: `https://e.com/c${photo}.jpg` })) },
  ];
}

export function futureISO(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export function experimentBody(overrides: Partial<CreateExperimentBody> = {}, perVariant = 5): CreateExperimentBody {
  const variant = (versionId: string, label: string) => ({
    versionId,
    videos: Array.from({ length: perVariant }, (_, index) => ({
      title: `${label} video ${index + 1}`,
      description: `${label} copy ${index + 1}`,
      segments: segmentsFor(),
    })),
  });
  return {
    account: { provider: 'youtube', accountId: 'acct-1' },
    videoType: 'voiceover',
    options: { voiceId: 'chatterbox:kokoro_af_heart' },
    startAt: futureISO(48),
    times: ['09:00', '18:00'],
    timezone: 'UTC',
    variants: [variant(VERSION_A, 'A'), variant(VERSION_B, 'B')],
    ...overrides,
  };
}

interface VersionRow {
  source: 'official' | 'user';
  owner_id: string | null;
  prompt_id: string | null;
}

export interface DbConfig {
  versions?: Record<string, VersionRow>;
  prompts?: Record<string, { visibility: string }>;
  accounts?: Array<{ provider: string; provider_account_id: string; needs_reconnect?: boolean }>;
  spend?: { spent: boolean; balance: number };
  scheduleInsertError?: { code?: string; message: string };
  slotInsertError?: { message: string };
  ledger?: Array<{ type: string; amount: number; reference_id: string | null }>;
}

export interface DbCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

export interface FakeDb {
  client: SupabaseClient;
  calls: DbCall[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  state: { schedule: Record<string, unknown> | null; slots: Array<Record<string, unknown>> };
}

export const OFFICIAL_VERSIONS: Record<string, VersionRow> = {
  [VERSION_A]: { source: 'official', owner_id: null, prompt_id: null },
  [VERSION_B]: { source: 'official', owner_id: null, prompt_id: null },
  [VERSION_C]: { source: 'official', owner_id: null, prompt_id: null },
};

export function fakeDb(config: DbConfig = {}): FakeDb {
  const calls: DbCall[] = [];
  const rpcCalls: FakeDb['rpcCalls'] = [];
  const state: FakeDb['state'] = { schedule: null, slots: [] };
  const versions = config.versions ?? OFFICIAL_VERSIONS;
  const accounts = config.accounts ?? [{ provider: 'youtube', provider_account_id: 'acct-1' }];

  function filterValue(call: DbCall, column: string): unknown {
    return call.filters.find(([name]) => name === column)?.[1];
  }

  function resolve(call: DbCall): { data: unknown; error: unknown } {
    const key = `${call.table}:${call.op}`;
    switch (key) {
      case 'prompt_versions:select': {
        const row = versions[String(filterValue(call, 'id'))];
        return { data: row === undefined ? null : { id: filterValue(call, 'id'), ...row }, error: null };
      }
      case 'user_prompts:select': {
        const row = config.prompts?.[String(filterValue(call, 'id'))];
        return { data: row ?? null, error: null };
      }
      case 'social_accounts:select':
        return { data: accounts, error: null };
      case 'schedules:select':
        return { data: state.schedule === null ? null : { id: state.schedule.id }, error: null };
      case 'schedules:insert':
        if (config.scheduleInsertError !== undefined) return { data: null, error: config.scheduleInsertError };
        state.schedule = call.payload as Record<string, unknown>;
        return { data: null, error: null };
      case 'schedules:delete':
        state.schedule = null;
        return { data: null, error: null };
      case 'scheduled_posts:select':
        return { data: state.slots, error: null };
      case 'scheduled_posts:insert': {
        if (config.slotInsertError !== undefined) return { data: null, error: config.slotInsertError };
        const rows = call.payload as Array<Record<string, unknown>>;
        state.slots = rows.map((row, index) => ({ ...row, id: `slot-${index}`, task_id: null }));
        return { data: state.slots.map((row) => ({ id: row.id, slot_at: row.slot_at, title: row.title })), error: null };
      }
      case 'token_transactions:select':
        return { data: config.ledger ?? [], error: null };
      default:
        return { data: null, error: null };
    }
  }

  function builder(table: string) {
    const call: DbCall = { table, op: 'select', filters: [] };
    calls.push(call);
    const chain = {
      select: () => chain,
      insert: (payload: unknown) => {
        call.op = 'insert';
        call.payload = payload;
        return chain;
      },
      update: (payload: unknown) => {
        call.op = 'update';
        call.payload = payload;
        return chain;
      },
      delete: () => {
        call.op = 'delete';
        return chain;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      in: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(resolve(call)),
      single: () => Promise.resolve(resolve(call)),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(call)).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'spend_tokens') return { data: config.spend ?? { spent: true, balance: 100 }, error: null };
    if (name === 'refund_batch_tokens') return { data: { refunded: true }, error: null };
    return { data: null, error: null };
  });

  return { client: { from: (table: string) => builder(table), rpc } as unknown as SupabaseClient, calls, rpcCalls, state };
}
