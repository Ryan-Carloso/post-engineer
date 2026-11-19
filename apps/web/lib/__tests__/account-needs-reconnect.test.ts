import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({ from: serviceFrom }),
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { markAccountNeedsReconnect } from '@/lib/account-needs-reconnect';

function updateChain(error: unknown = null) {
  const eq = vi.fn();
  const chain = { eq };
  eq.mockReturnValue(chain);
  Object.assign(chain, {
    then: (resolve: (value: { error: unknown }) => unknown) => {
      resolve({ error });
    },
  });
  return { update: vi.fn().mockReturnValue(chain), chain };
}

describe('markAccountNeedsReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets needs_reconnect once, only on the matching account', async () => {
    const { update, chain } = updateChain();
    serviceFrom.mockReturnValue({ update });

    await markAccountNeedsReconnect('user-1', 'bluesky', 'did:plc:dead');

    expect(serviceFrom).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0]?.[0] as { needs_reconnect?: boolean };
    expect(payload.needs_reconnect).toBe(true);
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.eq).toHaveBeenCalledWith('provider', 'bluesky');
    expect(chain.eq).toHaveBeenCalledWith('provider_account_id', 'did:plc:dead');
    expect(chain.eq).toHaveBeenCalledWith('needs_reconnect', false);
  });

  it('logs and does not throw when the write fails', async () => {
    const { update } = updateChain({ message: 'db down' });
    serviceFrom.mockReturnValue({ update });

    await expect(markAccountNeedsReconnect('user-1', 'youtube', 'UC1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[ACCOUNT] Failed to mark needs_reconnect',
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', provider: 'youtube', providerAccountId: 'UC1' }),
    );
  });
});
