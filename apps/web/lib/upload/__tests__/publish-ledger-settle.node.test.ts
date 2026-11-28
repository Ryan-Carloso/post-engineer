import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import type { PublishLedgerPartition } from '@/lib/upload/publish-ledger';
import { releaseGrantedClaims, settlePartition } from '@/lib/upload/publish-ledger-settle';

function fakeLedger(recordApplies: boolean = true): { client: SupabaseClient; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: fn === 'record_publish_ledger' ? recordApplies : true, error: null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function partition(overrides: Partial<PublishLedgerPartition> = {}): PublishLedgerPartition {
  return {
    scopeKey: 'direct:existing:abc',
    provider: 'instagram',
    granted: [
      { accountId: 'ig-1', claimToken: 'tok-1' },
      { accountId: 'ig-2', claimToken: 'tok-2' },
    ],
    replayed: [{ accountId: 'ig-0', success: true, mediaId: 'm-0' }],
    waiting: [],
    unknown: [],
    formData: new FormData(),
    ...overrides,
  };
}

describe('releaseGrantedClaims', () => {
  it('records every granted account as failed with the classified error', async () => {
    const { client, calls } = fakeLedger();
    await releaseGrantedClaims(client, partition(), new Error('instagram down'));
    expect(calls.map((call) => [call.fn, call.args.p_key, call.args.p_token, call.args.p_status, call.args.p_error])).toEqual([
      ['record_publish_ledger', 'publish:direct:existing:abc:instagram:ig-1', 'tok-1', 'failed', 'instagram down'],
      ['record_publish_ledger', 'publish:direct:existing:abc:instagram:ig-2', 'tok-2', 'failed', 'instagram down'],
    ]);
  });
});

describe('settlePartition', () => {
  it('records the fresh results and returns replayed results first', async () => {
    const { client, calls } = fakeLedger();
    const merged = await settlePartition(client, partition(), [
      { accountId: 'ig-1', success: true, mediaId: 'm-1' },
      { accountId: 'ig-2', success: false, error: 'token revoked' },
    ]);
    expect(merged.map((result) => result.accountId)).toEqual(['ig-0', 'ig-1', 'ig-2']);
    expect(calls.map((call) => [call.fn, call.args.p_status])).toEqual([
      ['record_publish_ledger', 'published'],
      ['record_publish_ledger', 'failed'],
    ]);
  });

  it('parks a success the ledger could not record as unknown', async () => {
    const { client, calls } = fakeLedger(false);
    await settlePartition(client, partition({ granted: [{ accountId: 'ig-1', claimToken: 'tok-1' }] }), [
      { accountId: 'ig-1', success: true, mediaId: 'm-1' },
    ]);
    const park = calls.find((call) => call.fn === 'mark_publish_unknown');
    expect(park?.args).toEqual({
      p_key: 'publish:direct:existing:abc:instagram:ig-1',
      p_token: 'tok-1',
      p_error: 'publish record lost after a successful post',
    });
  });

  it('releases every claim when the handler rejected the whole request', async () => {
    const { client, calls } = fakeLedger();
    await settlePartition(client, partition(), [{ accountId: '', success: false, error: 'Caption is required', errorCode: 'publish_rejected' }]);
    const failed = calls.filter((call) => call.fn === 'record_publish_ledger' && call.args.p_status === 'failed');
    expect(failed.map((call) => call.args.p_token)).toEqual(['tok-1', 'tok-2']);
  });
});
