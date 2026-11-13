import { describe, expect, it, vi, afterEach } from 'vitest';
import { PUBLISH_LEDGER_LEASE_SECONDS } from '@/lib/upload/publish-ledger';
import {
  PUBLISH_LEDGER_HEARTBEAT_MS,
  startLedgerHeartbeat,
  touchPublishLedger,
} from '@/lib/upload/publish-ledger-heartbeat';

function mockSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

describe('touchPublishLedger', () => {
  const input = { scopeKey: 'slot:s1:video:v.mp4', provider: 'fanvue', accountId: 'acc-1', claimToken: 'token-1' };

  it('renews the lease with the claim token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(touchPublishLedger(mockSupabase(rpc), input)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('touch_publish_ledger', {
      p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1',
      p_token: 'token-1',
      p_lease_seconds: PUBLISH_LEDGER_LEASE_SECONDS,
    });
  });

  it('returns false instead of throwing when the touch is lost', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(touchPublishLedger(mockSupabase(rpc), input)).resolves.toBe(false);
    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(touchPublishLedger(mockSupabase(failing), input)).resolves.toBe(false);
  });
});

describe('startLedgerHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('touches every granted claim on each beat and stops when told', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
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
    expect(PUBLISH_LEDGER_HEARTBEAT_MS).toBe(10 * 60 * 1000);

    const stop = startLedgerHeartbeat(mockSupabase(rpc), partition);
    await vi.advanceTimersByTimeAsync(PUBLISH_LEDGER_HEARTBEAT_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      'touch_publish_ledger',
      expect.objectContaining({ p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-1', p_token: 'token-1' }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'touch_publish_ledger',
      expect.objectContaining({ p_key: 'publish:slot:s1:video:v.mp4:fanvue:acc-2', p_token: 'token-2' }),
    );

    stop();
    await vi.advanceTimersByTimeAsync(PUBLISH_LEDGER_HEARTBEAT_MS * 2);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
