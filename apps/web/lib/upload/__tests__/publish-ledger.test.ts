import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import {
  PUBLISH_ACCOUNT_FIELDS,
  PUBLISH_IN_PROGRESS_CODE,
  PUBLISH_LEDGER_LEASE_SECONDS,
  PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS,
  PUBLISH_UNKNOWN_CODE,
  claimPublishAttempt,
  isValidPublishScopeKey,
  markPublishUnknown,
  partitionPublishAccounts,
  publishInProgressResult,
  publishLedgerKey,
  publishUnknownResult,
  recordPartitionResults,
  recordPublishAttempt,
  releaseClaimsForRequestRejection,
} from '@/lib/upload/publish-ledger';
import type { SocialProvider } from '@/lib/providers/registry';

const root = findRepoRoot(import.meta.url);
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

function mockSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

describe('publishLedgerKey', () => {
  it('names the scope, provider and account', () => {
    expect(publishLedgerKey('slot:s1:video:v.mp4', 'fanvue', 'acc-1')).toBe(
      'publish:slot:s1:video:v.mp4:fanvue:acc-1',
    );
  });
});

describe('isValidPublishScopeKey', () => {
  it('accepts the engine slot key and direct keys', () => {
    expect(isValidPublishScopeKey('slot:slot-1:video:final.mp4')).toBe(true);
    expect(isValidPublishScopeKey('direct:550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects anything that is not a scope key', () => {
    expect(isValidPublishScopeKey(undefined)).toBe(false);
    expect(isValidPublishScopeKey('')).toBe(false);
    expect(isValidPublishScopeKey('slot:slot-1')).toBe(false);
    expect(isValidPublishScopeKey('slot:slot-1:video:')).toBe(false);
    expect(isValidPublishScopeKey('random-key')).toBe(false);
    expect(isValidPublishScopeKey('slot:slot 1:video:v.mp4')).toBe(false);
    expect(isValidPublishScopeKey(`slot:${'x'.repeat(300)}:video:v.mp4`)).toBe(false);
  });
});

describe('claimPublishAttempt', () => {
  const input = { scopeKey: 'slot:s1:video:v.mp4', provider: 'fanvue', accountId: 'acc-1', userId: 'user-1' };

  it('claims a fresh key with a 30-minute lease', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'claimed' }, error: null });
    const claim = await claimPublishAttempt(mockSupabase(rpc), input);
    expect(claim.outcome).toBe('claimed');
    expect(claim.claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim.result).toBeNull();
    expect(rpc).toHaveBeenCalledWith('claim_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_provider: 'fanvue',
      p_account_id: 'acc-1',
      p_user_id: 'user-1',
      p_lease_seconds: PUBLISH_LEDGER_LEASE_SECONDS,
      p_token: claim.claimToken,
    });
    expect(PUBLISH_LEDGER_LEASE_SECONDS).toBe(30 * 60);
  });

  it('replays the recorded post instead of publishing again', async () => {
    const stored = { accountId: 'acc-1', success: true, postId: 'post-1' };
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'published', result: stored }, error: null });
    const claim = await claimPublishAttempt(mockSupabase(rpc), input);
    expect(claim).toEqual({ outcome: 'published', claimToken: null, result: stored });
  });

  it('reports an in-flight attempt with no token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'in_progress' }, error: null });
    const claim = await claimPublishAttempt(mockSupabase(rpc), input);
    expect(claim).toEqual({ outcome: 'in_progress', claimToken: null, result: null });
  });

  it('reports a parked-unknown claim with no token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'unknown' }, error: null });
    const claim = await claimPublishAttempt(mockSupabase(rpc), input);
    expect(claim).toEqual({ outcome: 'unknown', claimToken: null, result: null });
  });

  it('throws when the claim RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(claimPublishAttempt(mockSupabase(rpc), input)).rejects.toThrow(
      'claim_publish_ledger failed: db down',
    );
  });

  it('throws on an unknown outcome and on a malformed recorded result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'weird' }, error: null });
    await expect(claimPublishAttempt(mockSupabase(rpc), input)).rejects.toThrow('unknown outcome');
    rpc.mockResolvedValue({ data: { outcome: 'published', result: 'not-a-record' }, error: null });
    await expect(claimPublishAttempt(mockSupabase(rpc), input)).rejects.toThrow(
      'malformed recorded result',
    );
  });

  it('throws when the key belongs to another user', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
    await expect(claimPublishAttempt(mockSupabase(rpc), input)).rejects.toThrow(
      'claim_publish_ledger returned forbidden',
    );
  });
});

describe('recordPublishAttempt', () => {
  const base = {
    scopeKey: 'slot:s1:video:v.mp4',
    provider: 'fanvue',
    accountId: 'acc-1',
    claimToken: 'token-1',
  };

  it('records a published result with its post id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: 'token-1',
      p_status: 'published',
      p_result: result,
      p_error: null,
      p_error_code: null,
    });
  });

  it('records a failure so the next retry can claim a fresh attempt', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = { accountId: 'acc-1', success: false, error: 'Fanvue 503', errorCode: 'transient' };
    await expect(recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: 'token-1',
      p_status: 'failed',
      p_result: null,
      p_error: 'Fanvue 503',
      p_error_code: 'transient',
    });
  });

  it('returns false instead of throwing when the record is lost', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result })).resolves.toBe(false);
    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(recordPublishAttempt(mockSupabase(failing), { ...base, accountResult: result })).resolves.toBe(false);
  });

  it('retries a transient record error and succeeds on the second attempt', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
      .mockResolvedValueOnce({ data: true, error: null });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(
      recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result }, { sleep }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS[0]);
  });

  it('gives up after the retry budget and reports the delays it waited', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(
      recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result }, { sleep }),
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS.length + 1);
    expect(sleep).toHaveBeenCalledTimes(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS.length);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS);
  });

  it('does not retry a lost claim: the fencing rejection is final', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(
      recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result }, { sleep }),
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('with maxAttempts 1 a transient error fails at once (retry negative control)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    const result = { accountId: 'acc-1', success: true, postId: 'post-1' };
    await expect(
      recordPublishAttempt(mockSupabase(rpc), { ...base, accountResult: result }, { sleep, maxAttempts: 1 }),
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('markPublishUnknown', () => {
  const base = {
    scopeKey: 'slot:s1:video:v.mp4',
    provider: 'fanvue',
    accountId: 'acc-1',
    claimToken: 'token-1',
    error: 'publish record lost after a successful post',
  };

  it('parks the claim as unknown with the claim token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(markPublishUnknown(mockSupabase(rpc), base)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('mark_publish_unknown', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: 'token-1',
      p_error: 'publish record lost after a successful post',
    });
  });

  it('returns false instead of throwing when the park is lost', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(markPublishUnknown(mockSupabase(rpc), base, { sleep })).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(markPublishUnknown(mockSupabase(failing), base, { sleep })).resolves.toBe(false);
    expect(failing).toHaveBeenCalledTimes(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS.length + 1);
  });
});

describe('recordPartitionResults', () => {
  const partition = {
    scopeKey: 'slot:s1:video:v.mp4',
    provider: 'fanvue',
    granted: [
      { accountId: 'acc-1', claimToken: 'token-1' },
      { accountId: 'acc-2', claimToken: 'token-2' },
    ],
    replayed: [],
    waiting: [],
    unknown: [],
    formData: new FormData(),
  } as never;

  it('returns the success results it could not record, so the route can park them', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (args.p_key === 'publish:slot:s1:video:v.mp4:fanvue:acc-1') {
        return { data: null, error: { message: 'db down' } };
      }
      return { data: true, error: null };
    });
    const unrecorded = await recordPartitionResults(mockSupabase(rpc), partition, [
      { accountId: 'acc-1', success: true, postId: 'post-1' },
      { accountId: 'acc-2', success: false, error: 'Fanvue 503', errorCode: 'transient' },
    ]);
    expect(unrecorded).toEqual(['acc-1']);
  });

  it('returns nothing when every result was recorded', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const unrecorded = await recordPartitionResults(mockSupabase(rpc), partition, [
      { accountId: 'acc-1', success: true, postId: 'post-1' },
      { accountId: 'acc-2', success: false, error: 'Fanvue 503', errorCode: 'transient' },
    ]);
    expect(unrecorded).toEqual([]);
  });

  it('does not report a failed result that could not be recorded: nothing was published', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (args.p_key === 'publish:slot:s1:video:v.mp4:fanvue:acc-2') {
        return { data: null, error: { message: 'db down' } };
      }
      return { data: true, error: null };
    });
    const unrecorded = await recordPartitionResults(mockSupabase(rpc), partition, [
      { accountId: 'acc-1', success: true, postId: 'post-1' },
      { accountId: 'acc-2', success: false, error: 'Fanvue 503', errorCode: 'transient' },
    ]);
    expect(unrecorded).toEqual([]);
  });
});

describe('publishUnknownResult', () => {
  it('is a failure that tells the caller to verify before posting again', () => {
    const result = publishUnknownResult('acc-1');
    expect(result.accountId).toBe('acc-1');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(PUBLISH_UNKNOWN_CODE);
    expect(result.errorCode).toBe('publish_unknown');
    expect(result.error).toContain('may already have published');
  });
});

describe('partitionPublishAccounts with an unknown claim', () => {
  it('parks the unknown account and never sends it to the handler', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (args.p_key === 'publish:slot:s1:video:v.mp4:fanvue:acc-1') {
        return { data: { outcome: 'unknown' }, error: null };
      }
      return { data: { outcome: 'claimed' }, error: null };
    });
    const formData = new FormData();
    formData.append('fanvueAccountIds', 'acc-1');
    formData.append('fanvueAccountIds', 'acc-2');
    const partition = await partitionPublishAccounts(
      mockSupabase(rpc),
      'slot:s1:video:v.mp4',
      'fanvue',
      'user-1',
      formData,
    );
    expect(partition.unknown).toHaveLength(1);
    expect(partition.unknown[0]?.accountId).toBe('acc-1');
    expect(partition.unknown[0]?.errorCode).toBe('publish_unknown');
    expect(partition.granted).toEqual([{ accountId: 'acc-2', claimToken: expect.any(String) }]);
    expect(partition.formData.getAll('fanvueAccountIds')).toEqual(['acc-2']);
  });

  it('releases already-granted claims as failed when a later claim throws, and rethrows', async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'record_publish_ledger') return { data: true, error: null };
      if (args.p_key === 'publish:slot:s1:video:v.mp4:fanvue:acc-2') {
        return { data: null, error: { message: 'db down' } };
      }
      return { data: { outcome: 'claimed' }, error: null };
    });
    const formData = new FormData();
    formData.append('fanvueAccountIds', 'acc-1');
    formData.append('fanvueAccountIds', 'acc-2');
    await expect(
      partitionPublishAccounts(mockSupabase(rpc), 'slot:s1:video:v.mp4', 'fanvue', 'user-1', formData),
    ).rejects.toThrow('claim_publish_ledger failed: db down');
    // Nothing was published, so the granted claim is released at once
    // instead of parking the next retry in publish_in_progress for the
    // 30-minute lease.
    const claimCall = rpc.mock.calls.find(
      ([fn, args]) => fn === 'claim_publish_ledger' && args.p_key === 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
    );
    expect(claimCall).toBeDefined();
    const token = (claimCall?.[1] as Record<string, unknown> | undefined)?.p_token;
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: token,
      p_status: 'failed',
      p_result: null,
      p_error: 'claim phase failed',
      p_error_code: 'transient',
    });
  });
});

describe('releaseClaimsForRequestRejection', () => {
  const partition = {
    scopeKey: 'slot:s1:video:v.mp4',
    provider: 'fanvue',
    granted: [
      { accountId: 'acc-1', claimToken: 'token-1' },
      { accountId: 'acc-2', claimToken: 'token-2' },
    ],
    replayed: [],
    waiting: [],
    formData: new FormData(),
  } as never;

  it('records every granted claim as failed with the rejection error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await releaseClaimsForRequestRejection(mockSupabase(rpc), partition, [
      { accountId: '', success: false, error: 'Caption is required', errorCode: 'publish_rejected' },
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: 'token-1',
      p_status: 'failed',
      p_result: null,
      p_error: 'Caption is required',
      p_error_code: 'publish_rejected',
    });
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-2',
      p_token: 'token-2',
      p_status: 'failed',
      p_result: null,
      p_error: 'Caption is required',
      p_error_code: 'publish_rejected',
    });
  });

  it('defaults the code when the rejection carries none', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await releaseClaimsForRequestRejection(mockSupabase(rpc), partition, [
      { accountId: '', success: false, error: 'missing caption' },
    ]);
    expect(rpc).toHaveBeenCalledWith('record_publish_ledger', expect.objectContaining({
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_status: 'failed',
      p_error: 'missing caption',
      p_error_code: 'publish_rejected',
    }));
  });

  it('does nothing without a request-level rejection', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await releaseClaimsForRequestRejection(mockSupabase(rpc), partition, [
      { accountId: 'acc-1', success: false, error: 'Fanvue 503', errorCode: 'transient' },
    ]);
    expect(rpc).not.toHaveBeenCalled();
    await releaseClaimsForRequestRejection(mockSupabase(rpc), partition, []);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('publishInProgressResult', () => {
  it('is a failure the engine waits on, not a user error', () => {
    const result = publishInProgressResult('acc-1');
    expect(result.accountId).toBe('acc-1');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(PUBLISH_IN_PROGRESS_CODE);
    expect(result.errorCode).toBe('publish_in_progress');
  });
});

describe('publish account fields stay in sync with the handlers', () => {
  const singleHandlerFiles: Array<[SocialProvider, string]> = [
    ['bluesky', 'apps/web/lib/upload/bluesky-handler.ts'],
    ['linkedin', 'apps/web/lib/upload/linkedin-handler.ts'],
    ['threads', 'apps/web/lib/upload/threads-handler.ts'],
    ['facebook', 'apps/web/lib/upload/facebook-handler.ts'],
    ['pinterest', 'apps/web/lib/upload/pinterest-handler.ts'],
    ['fanvue', 'apps/web/lib/upload/fanvue-handler.ts'],
    ['3speak', 'apps/web/lib/upload/threespeak-handler.ts'],
    ['rumble', 'apps/web/lib/upload/rumble-handler.ts'],
  ];

  it('each single-handler provider reads the field the ledger map names', () => {
    for (const [provider, path] of singleHandlerFiles) {
      const matches = [...read(path).matchAll(/getAccountIdsFromFormData\(formData, '([^']+)'\)/g)];
      expect(matches).toHaveLength(1);
      expect(PUBLISH_ACCOUNT_FIELDS[provider]).toBe(matches[0][1]);
    }
  });

  it('youtube and instagram read the fields the ledger map names', () => {
    const source = read('apps/web/lib/upload/handlers.ts');
    const fields = [...source.matchAll(/parseAccountIds\(formData, '([^']+)'\)/g)].map((match) => match[1]);
    expect(fields.sort()).toEqual(['accountIds', 'igAccountIds']);
    expect(PUBLISH_ACCOUNT_FIELDS.youtube).toBe('accountIds');
    expect(PUBLISH_ACCOUNT_FIELDS.instagram).toBe('igAccountIds');
  });
});
