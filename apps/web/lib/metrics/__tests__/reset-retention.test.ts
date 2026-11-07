import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { resetYouTubeRetentionWindows } from '../reset-retention';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

const rpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never);
});

describe('resetYouTubeRetentionWindows', () => {
  it('clears the channel windows through the service-role RPC', async () => {
    rpc.mockResolvedValue({ error: null });
    await resetYouTubeRetentionWindows('user-1', 'chan-1');

    expect(createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reset_post_metrics_windows', {
      p_user_id: 'user-1',
      p_account_id: 'chan-1',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a failed RPC instead of hiding it', async () => {
    rpc.mockResolvedValue({ error: { message: 'db down' } });
    await resetYouTubeRetentionWindows('user-1', 'chan-1');

    expect(logger.error).toHaveBeenCalledWith('[youtube-oauth] retention windows reset failed', {
      userId: 'user-1',
      channelId: 'chan-1',
      error: 'db down',
    });
  });

  it('logs a thrown client error and never fails the connect', async () => {
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => {
      throw new Error('missing service key');
    });
    await expect(resetYouTubeRetentionWindows('user-1', 'chan-1')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('[youtube-oauth] retention windows reset threw', {
      userId: 'user-1',
      channelId: 'chan-1',
      error: 'missing service key',
    });
  });
});
