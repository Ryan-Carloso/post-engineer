import { describe, it, expect, vi } from 'vitest';
import {
  refreshExpiringSocialTokens,
  TOKEN_REFRESH_BATCH_LIMIT,
  TOKEN_REFRESH_FAILED_EVENT,
  TOKEN_REFRESH_PROVIDERS,
  TOKEN_REFRESH_WINDOW_MS,
  type SaveRefreshedResult,
  type TokenRefreshCandidate,
  type TokenRefreshDeps,
} from '@/lib/social-token-refresh';
import { ThreadsError, InstagramApiError } from '@/lib/errors';
import { isUnauthorizedError } from '@/lib/account-break';

const NOW = new Date('2026-11-17T12:00:00Z');

function candidate(overrides: Partial<TokenRefreshCandidate> = {}): TokenRefreshCandidate {
  return {
    id: 'row-1',
    userId: '11111111-1111-4111-8111-111111111111',
    provider: 'instagram',
    providerAccountId: 'ig-1',
    tokens: { access_token: 'old-token', token_type: 'bearer', expiry_date: NOW.getTime() + 86_400_000 },
    updatedAt: '2026-09-18T12:00:00.123456+00:00',
    ...overrides,
  };
}

function makeDeps(candidates: TokenRefreshCandidate[], save: SaveRefreshedResult = 'saved') {
  const listExpiring = vi.fn(async () => candidates);
  const saveRefreshed = vi.fn(async () => save);
  const instagram = vi.fn(async () => ({ accessToken: 'new-ig-token', expiresInSeconds: 5_184_000 }));
  const threads = vi.fn(async () => ({ accessToken: 'new-th-token', expiresInSeconds: 5_184_000 }));
  const reportBroken = vi.fn();
  const track = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };
  const deps: TokenRefreshDeps = {
    store: { listExpiring, saveRefreshed },
    refreshers: { instagram, threads },
    isUnauthorized: isUnauthorizedError,
    reportBroken,
    track,
    logger,
    now: () => NOW,
  };
  return { deps, listExpiring, saveRefreshed, instagram, threads, reportBroken, track, logger };
}

describe('refreshExpiringSocialTokens', () => {
  it('lists Instagram and Threads tokens that expire between now and the window, one past the batch limit', async () => {
    const { deps, listExpiring } = makeDeps([]);
    await refreshExpiringSocialTokens(deps);
    expect(listExpiring).toHaveBeenCalledWith(
      TOKEN_REFRESH_PROVIDERS,
      NOW,
      new Date(NOW.getTime() + TOKEN_REFRESH_WINDOW_MS),
      TOKEN_REFRESH_BATCH_LIMIT + 1,
    );
    expect(TOKEN_REFRESH_PROVIDERS).toEqual(['instagram', 'threads']);
  });

  it('refreshes each token with its provider and stores the new token and expiry, keeping the other payload fields', async () => {
    const ig = candidate();
    const th = candidate({ id: 'row-2', provider: 'threads', providerAccountId: 'th-1', tokens: { access_token: 'old-th' } });
    const { deps, instagram, threads, saveRefreshed } = makeDeps([ig, th]);

    const report = await refreshExpiringSocialTokens(deps);

    expect(instagram).toHaveBeenCalledWith('old-token');
    expect(threads).toHaveBeenCalledWith('old-th');
    const expiresAt = new Date(NOW.getTime() + 5_184_000 * 1000);
    expect(saveRefreshed).toHaveBeenNthCalledWith(
      1,
      ig,
      { access_token: 'new-ig-token', token_type: 'bearer', expiry_date: expiresAt.getTime() },
      expiresAt,
    );
    expect(saveRefreshed).toHaveBeenNthCalledWith(
      2,
      th,
      { access_token: 'new-th-token', expiry_date: expiresAt.getTime() },
      expiresAt,
    );
    expect(report).toEqual({ refreshed: 2, failed: 0, unauthorized: 0, skipped: 0, truncated: false });
  });

  it('reports an invalidated Meta token (code 190) to the owner and keeps going with the next account', async () => {
    const dead = candidate();
    const healthy = candidate({ id: 'row-2', provider: 'threads', providerAccountId: 'th-1' });
    const { deps, instagram, reportBroken, track, saveRefreshed, logger } = makeDeps([dead, healthy]);
    const error = new InstagramApiError('Error validating access token: The session has been invalidated', 400, undefined, 190);
    instagram.mockRejectedValueOnce(error);

    const report = await refreshExpiringSocialTokens(deps);

    expect(reportBroken).toHaveBeenCalledWith(dead, error);
    expect(track).toHaveBeenCalledWith(TOKEN_REFRESH_FAILED_EVENT, {
      provider: 'instagram',
      account_id: 'ig-1',
      user_id: dead.userId,
      unauthorized: true,
    });
    expect(logger.error).toHaveBeenCalledWith('[token-refresh] refresh failed', error, {
      provider: 'instagram',
      accountId: 'ig-1',
      unauthorized: true,
    });
    expect(saveRefreshed).toHaveBeenCalledTimes(1);
    expect(saveRefreshed).toHaveBeenCalledWith(healthy, expect.anything(), expect.any(Date));
    expect(report).toEqual({ refreshed: 1, failed: 1, unauthorized: 1, skipped: 0, truncated: false });
  });

  it('does not email the owner on a transient failure (it retries on the next run)', async () => {
    const { deps, threads, reportBroken, track } = makeDeps([candidate({ provider: 'threads' })]);
    threads.mockRejectedValueOnce(new ThreadsError('THREADS_TOKEN_REFRESH_FAILED: status 503', 503));

    const report = await refreshExpiringSocialTokens(deps);

    expect(reportBroken).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(TOKEN_REFRESH_FAILED_EVENT, expect.objectContaining({ unauthorized: false }));
    expect(report).toEqual({ refreshed: 0, failed: 1, unauthorized: 0, skipped: 0, truncated: false });
  });

  it.each([
    ['an empty access token', { accessToken: '', expiresInSeconds: 100 }],
    ['a zero lifetime', { accessToken: 'tok', expiresInSeconds: 0 }],
    ['a NaN lifetime', { accessToken: 'tok', expiresInSeconds: Number.NaN }],
  ])('never stores a refresh answer with %s', async (_label, answer) => {
    const { deps, instagram, saveRefreshed, logger } = makeDeps([candidate()]);
    instagram.mockResolvedValueOnce(answer);

    const report = await refreshExpiringSocialTokens(deps);

    expect(saveRefreshed).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[token-refresh] refresh failed', expect.any(Error), expect.anything());
    expect(report.failed).toBe(1);
  });

  it('skips a row whose stored payload has no access token, without calling the provider', async () => {
    const { deps, instagram, logger } = makeDeps([candidate({ tokens: { access_token: '' } })]);

    const report = await refreshExpiringSocialTokens(deps);

    expect(instagram).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[token-refresh] stored token has no access_token', null, {
      provider: 'instagram',
      accountId: 'ig-1',
    });
    expect(report).toEqual({ refreshed: 0, failed: 0, unauthorized: 0, skipped: 1, truncated: false });
  });

  it('counts a row that changed during the run (reconnect) as skipped, not refreshed', async () => {
    const { deps, logger } = makeDeps([candidate()], 'row_changed');

    const report = await refreshExpiringSocialTokens(deps);

    expect(logger.info).toHaveBeenCalledWith(
      '[token-refresh] account changed during refresh, kept the newer row',
      { provider: 'instagram', accountId: 'ig-1' },
    );
    expect(report).toEqual({ refreshed: 0, failed: 0, unauthorized: 0, skipped: 1, truncated: false });
  });

  it('processes at most the batch limit and reports the rest as truncated', async () => {
    const many = Array.from({ length: TOKEN_REFRESH_BATCH_LIMIT + 1 }, (_, index) =>
      candidate({ id: `row-${index}`, providerAccountId: `ig-${index}` }),
    );
    const { deps, instagram, logger } = makeDeps(many);

    const report = await refreshExpiringSocialTokens(deps);

    expect(instagram).toHaveBeenCalledTimes(TOKEN_REFRESH_BATCH_LIMIT);
    expect(report.refreshed).toBe(TOKEN_REFRESH_BATCH_LIMIT);
    expect(report.truncated).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      '[token-refresh] batch limit reached, the rest waits for the next run',
      { limit: TOKEN_REFRESH_BATCH_LIMIT },
    );
  });

  it('does not report truncation when exactly the batch limit is listed', async () => {
    const exact = Array.from({ length: TOKEN_REFRESH_BATCH_LIMIT }, (_, index) =>
      candidate({ id: `row-${index}` }),
    );
    const { deps, logger } = makeDeps(exact);

    const report = await refreshExpiringSocialTokens(deps);

    expect(report.truncated).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
