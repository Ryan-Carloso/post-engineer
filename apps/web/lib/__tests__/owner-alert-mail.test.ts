import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAccountBreak, normalizeFrom, type OwnerAlertDeps } from '@/lib/owner-alert-mail';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FROM = 'Post Engineer <alerts@notifications.post-engineer.com>';

function db(options: { claim?: boolean; email?: string | null; failResend?: boolean } = {}) {
  const calls = { claim: 0, release: 0, resend: 0 };
  const claim = options.claim ?? true;
  const sent: Array<{ subject?: string; html?: string; from?: string }> = [];
  const supabase = {
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'claim_owner_alert') {
        calls.claim += 1;
        return { data: calls.claim === 1 && claim, error: null };
      }
      if (fn === 'release_owner_alert') {
        calls.release += 1;
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: options.email === null ? null : { email: options.email ?? 'owner@example.com' } },
          error: null,
        })),
      },
    },
    from: vi.fn(),
  };
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.resend += 1;
    sent.push(JSON.parse(String(init?.body ?? '{}')));
    if (options.failResend) return new Response('no', { status: 500 });
    return new Response('{"id":"email_1"}', { status: 200 });
  });
  const deps: OwnerAlertDeps = {
    supabase: supabase as unknown as OwnerAlertDeps['supabase'],
    fetch: fetchImpl as unknown as typeof fetch,
    env: { apiKey: 're_test_key', from: `"${FROM}"`, appUrl: 'https://post-engineer.com' },
  };
  return { calls, sent, deps, fetchImpl };
}

const decryptError = new Error('Invalid authentication tag length: 2');

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeFrom', () => {
  it('strips one pair of surrounding quotes', () => {
    expect(normalizeFrom(`"${FROM}"`)).toBe(FROM);
    expect(normalizeFrom(FROM)).toBe(FROM);
  });
});

describe('notifyAccountBreak', () => {
  it('sends once and skips Resend when the claim is already taken', async () => {
    const harness = db();
    const notice = {
      userId: USER_ID,
      provider: 'youtube',
      accountId: 'UC1',
      socialAccountId: 'rec-1',
      accountName: 'Sample <channel>',
      error: decryptError,
    };
    await notifyAccountBreak(notice, harness.deps);
    await notifyAccountBreak(notice, harness.deps);
    expect(harness.calls.resend).toBe(1);
    expect(harness.calls.claim).toBe(2);
    expect(harness.calls.release).toBe(0);
    expect(harness.sent[0]?.from).toBe(FROM);
    expect(harness.sent[0]?.subject).toBe('Reconnect your YouTube account');
    expect(harness.sent[0]?.html).toContain('Sample &lt;channel&gt;');
    expect(harness.sent[0]?.html).toContain('The saved login is corrupted and cannot be read.');
    expect(harness.sent[0]?.html).toContain('https://post-engineer.com/accounts');
    expect(harness.sent[0]?.html).not.toContain('authentication tag');
  });

  it('releases the claim when Resend rejects the email', async () => {
    const harness = db({ failResend: true });
    await notifyAccountBreak(
      { userId: USER_ID, provider: 'youtube', accountId: 'UC1', socialAccountId: 'rec-1', error: new Error('Unauthorized') },
      harness.deps,
    );
    expect(harness.calls.resend).toBe(1);
    expect(harness.calls.release).toBe(1);
  });

  it('releases the claim when the owner has no email', async () => {
    const harness = db({ email: null });
    await notifyAccountBreak(
      { userId: USER_ID, provider: 'youtube', accountId: 'UC1', socialAccountId: 'rec-1', error: decryptError },
      harness.deps,
    );
    expect(harness.calls.resend).toBe(0);
    expect(harness.calls.release).toBe(1);
  });

  it('does not claim or send when the key is missing or the error is not a break', async () => {
    const harness = db();
    harness.deps.env = { apiKey: '', from: FROM };
    await notifyAccountBreak(
      { userId: USER_ID, provider: 'youtube', accountId: 'UC1', socialAccountId: 'rec-1', error: decryptError },
      harness.deps,
    );
    await notifyAccountBreak(
      { userId: USER_ID, provider: 'youtube', accountId: 'UC1', socialAccountId: 'rec-1', error: new Error('token revoked') },
      { ...harness.deps, env: { apiKey: 're_test_key', from: FROM } },
    );
    expect(harness.calls.claim).toBe(0);
    expect(harness.calls.resend).toBe(0);
  });
});
