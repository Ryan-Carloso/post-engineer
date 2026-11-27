// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.fn();
const partitionPublishAccounts = vi.fn();
const settlePartition = vi.fn();
const releaseGrantedClaims = vi.fn();
const stopHeartbeat = vi.fn();
const startLedgerHeartbeat = vi.fn(() => stopHeartbeat);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/upload/publish-handlers', () => ({
  PUBLISH_HANDLERS: new Proxy({}, { get: () => handler }),
}));
vi.mock('@/lib/upload/publish-ledger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload/publish-ledger')>()),
  createPublishLedgerClient: () => ({ ledger: true }),
  partitionPublishAccounts: (...args: unknown[]) => partitionPublishAccounts(...args),
}));
vi.mock('@/lib/upload/publish-ledger-settle', () => ({
  settlePartition: (...args: unknown[]) => settlePartition(...args),
  releaseGrantedClaims: (...args: unknown[]) => releaseGrantedClaims(...args),
}));
vi.mock('@/lib/upload/publish-ledger-heartbeat', () => ({
  startLedgerHeartbeat: (...args: unknown[]) => startLedgerHeartbeat(...(args as [])),
}));

import { AuthError, InstagramApiError, ValidationError } from '@/lib/errors';
import { publishContent } from '@/lib/upload/publish-content';

const SCOPE = 'slot:abc:video:clip.mp4';

function input(scopeKeyRaw: unknown = SCOPE) {
  return {
    provider: 'youtube' as const,
    userId: 'user-1',
    formData: new FormData(),
    scopeKeyRaw,
    logId: 'log-1',
    startTime: Date.now(),
  };
}

function partition(granted: Array<{ accountId: string; claimToken: string }>) {
  return {
    scopeKey: SCOPE,
    provider: 'youtube',
    granted,
    replayed: [],
    waiting: [],
    unknown: [],
    formData: new FormData(),
  };
}

describe('publishContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the handler with the original form when no valid scope key is sent', async () => {
    handler.mockResolvedValue({ success: true, successCount: 1, results: [{ accountId: 'a', success: true }] });
    const request = input('direct-without-prefix');
    const result = await publishContent(request);
    expect(result).toEqual({
      ok: true,
      response: { success: true, successCount: 1, results: [{ accountId: 'a', success: true }] },
    });
    expect(partitionPublishAccounts).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(request.formData, 'user-1', 'log-1', request.startTime);
  });

  it('skips the handler when every account is already claimed elsewhere', async () => {
    partitionPublishAccounts.mockResolvedValue({
      ...partition([]),
      waiting: [{ accountId: 'a', success: false, errorCode: 'publish_in_progress' }],
    });
    const result = await publishContent(input());
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      response: {
        success: false,
        successCount: 0,
        results: [{ accountId: 'a', success: false, errorCode: 'publish_in_progress' }],
      },
    });
  });

  it('settles the granted claims and merges the replayed results', async () => {
    const granted = partition([{ accountId: 'a', claimToken: 't' }]);
    partitionPublishAccounts.mockResolvedValue(granted);
    handler.mockResolvedValue({ success: true, results: [{ accountId: 'a', success: true }] });
    settlePartition.mockResolvedValue([
      { accountId: 'a', success: true },
      { accountId: 'b', success: false },
    ]);
    const result = await publishContent(input());
    expect(handler).toHaveBeenCalledWith(granted.formData, 'user-1', 'log-1', expect.any(Number));
    expect(result).toEqual({
      ok: true,
      response: {
        success: true,
        successCount: 1,
        results: [
          { accountId: 'a', success: true },
          { accountId: 'b', success: false },
        ],
      },
    });
    expect(startLedgerHeartbeat).toHaveBeenCalledTimes(1);
    expect(stopHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('releases the claims and reports a 400 rejection when the handler rejects the form', async () => {
    partitionPublishAccounts.mockResolvedValue(partition([{ accountId: 'a', claimToken: 't' }]));
    const cause = new ValidationError('Video title is required', 'title');
    handler.mockRejectedValue(cause);
    const result = await publishContent(input());
    expect(result).toEqual({
      ok: false,
      status: 400,
      errorCode: 'publish_rejected',
      error: 'Video title is required',
      cause,
    });
    expect(releaseGrantedClaims).toHaveBeenCalledTimes(1);
    expect(stopHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('maps an auth failure to 401 disconnected', async () => {
    handler.mockRejectedValue(new AuthError('nope', 'invalid_token'));
    const result = await publishContent(input(null));
    expect(result).toMatchObject({ ok: false, status: 401, errorCode: 'disconnected' });
  });

  it('keeps the Instagram status code and classifies a 503 as transient', async () => {
    handler.mockRejectedValue(new InstagramApiError('busy', 503));
    const result = await publishContent(input(null));
    expect(result).toMatchObject({ ok: false, status: 503, errorCode: 'transient' });
  });

  it('maps an unexpected failure to a transient 500 with its message', async () => {
    handler.mockRejectedValue(new Error('socket hang up'));
    const result = await publishContent(input(null));
    expect(result).toMatchObject({ ok: false, status: 500, errorCode: 'transient', error: 'socket hang up' });
  });

  it('reports a failed claim phase as a rejection and never calls the handler', async () => {
    partitionPublishAccounts.mockRejectedValue(new Error('claim_publish_ledger failed'));
    const result = await publishContent(input());
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 500, errorCode: 'transient' });
  });
});
