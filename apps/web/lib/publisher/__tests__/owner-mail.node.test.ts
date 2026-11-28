import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

import { logger } from '@/lib/logger';
import {
  notifyPublishFailed,
  notifyPublishPartial,
  resetOwnerMailWarningForTests,
  type MailDb,
  type OwnerMailDeps,
} from '@/lib/publisher/owner-mail';

const ENV = { apiKey: 'resend-key', from: '"Post Engineer <hi@example.com>"', appUrl: 'https://app.example.com/' };

function build(options: { claim?: boolean | 'error'; email?: string | null; accounts?: unknown; response?: { ok: boolean; status?: number } } = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'claim_owner_alert') {
      return options.claim === 'error' ? { data: null, error: { message: 'rpc down' } } : { data: options.claim ?? true, error: null };
    }
    return { data: null, error: null };
  });
  const getUserById = vi.fn(
    async (): Promise<{ data: { user: { email?: string | null } | null } | null; error: unknown }> => ({
      data: { user: { email: options.email === undefined ? 'owner@example.com' : options.email } },
      error: null,
    }),
  );
  const select = vi.fn(() => ({
    eq: vi.fn(async () => ({
      data:
        options.accounts ??
        [{ provider: 'youtube', provider_account_id: 'yt-1', account_name: 'Maya Channel' }, 'junk', { provider: 'x' }],
      error: null,
    })),
  }));
  const supabase: MailDb = { rpc, auth: { admin: { getUserById } }, from: vi.fn(() => ({ select })) };
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ ok: options.response?.ok ?? true, status: options.response?.status ?? 200 }) as Response);
  const deps: OwnerMailDeps = { supabase, fetch: fetchMock, env: ENV };
  return { deps, rpc, fetchMock, getUserById };
}

function sentBody(fetchMock: ReturnType<typeof build>['fetchMock']): { subject: string; html: string; text: string; to: string[]; from: string } {
  const init = fetchMock.mock.calls[0]![1]!;
  return JSON.parse(String(init.body));
}

const FAILED = {
  userId: 'user-1',
  slotId: 'slot-1',
  title: 'Porto in one minute',
  reason: 'all providers failed: youtube token=SECRET',
  persona: 'Maya',
  failures: [{ provider: 'youtube', accountId: 'yt-1', reason: 'token revoked' }],
};

describe('notifyPublishFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerMailWarningForTests();
  });

  it('claims the legacy dedup key and mails the owner with the persona, the scrubbed reason and the failed account', async () => {
    const { deps, rpc, fetchMock } = build();
    await notifyPublishFailed(FAILED, deps);

    expect(rpc).toHaveBeenCalledWith('claim_owner_alert', { p_user_id: 'user-1', p_dedup_key: 'publish:slot-1', p_window_days: null });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer resend-key');
    const body = sentBody(fetchMock);
    expect(body.subject).toBe('A post could not be published');
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.from).toBe('Post Engineer <hi@example.com>');
    expect(body.text).toContain('Porto in one minute');
    expect(body.text).toContain('Persona: Maya');
    expect(body.text).toContain('What happened: all providers failed: youtube token=[redacted]');
    expect(body.text).not.toContain('SECRET');
    expect(body.text).toContain('YouTube — Maya Channel — token revoked');
    expect(body.text).toContain('Open the post: https://app.example.com/posts/slot-1');
    expect(body.text).toContain('Reconnect accounts: https://app.example.com/accounts');
    expect(body.html).toContain('<a href="https://app.example.com/posts/slot-1">Open the post</a>');
  });

  it('falls back to the raw account id and to the provider label when the name is unknown', async () => {
    const { deps, fetchMock } = build({ accounts: [] });
    await notifyPublishFailed(
      { ...FAILED, failures: [{ provider: 'rumble', accountId: 'ru-9', reason: '' }, { provider: 'fanvue', accountId: '', reason: 'x' }] },
      deps,
    );
    const { text } = sentBody(fetchMock);
    expect(text).toContain('Rumble — ru-9');
    expect(text).toContain('Fanvue — Fanvue — x');
  });

  it('escapes user text in the HTML card', async () => {
    const { deps, fetchMock } = build();
    await notifyPublishFailed({ ...FAILED, title: '<b>Hi & "bye"</b>' }, deps);
    expect(sentBody(fetchMock).html).toContain('&lt;b&gt;Hi &amp; &quot;bye&quot;&lt;/b&gt;');
  });

  it('skips the account lookup and lines when there are no failures', async () => {
    const { deps, fetchMock } = build();
    await notifyPublishFailed({ ...FAILED, failures: [], persona: null, title: '   ' }, deps);
    const { text } = sentBody(fetchMock);
    expect(text).toContain('A scheduled post');
    expect(text).not.toContain('Persona:');
    expect(deps.supabase!.from).not.toHaveBeenCalled();
  });

  it('does nothing without an owner or a slot', async () => {
    const { deps, rpc } = build();
    await notifyPublishFailed({ ...FAILED, userId: null }, deps);
    await notifyPublishFailed({ ...FAILED, slotId: '' }, deps);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not email when the alert was already claimed', async () => {
    const { deps, fetchMock } = build({ claim: false });
    await notifyPublishFailed(FAILED, deps);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and sends nothing when the claim fails', async () => {
    const { deps, fetchMock } = build({ claim: 'error' });
    await notifyPublishFailed(FAILED, deps);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[OWNER_ALERT] claim failed', expect.any(Error));
  });

  it('releases the claim when the owner has no email', async () => {
    const { deps, rpc, fetchMock } = build({ email: null });
    await notifyPublishFailed(FAILED, deps);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('release_owner_alert', { p_user_id: 'user-1', p_dedup_key: 'publish:slot-1' });
  });

  it('releases the claim and logs when Resend rejects the email', async () => {
    const { deps, rpc } = build({ response: { ok: false, status: 422 } });
    await notifyPublishFailed(FAILED, deps);
    expect(rpc).toHaveBeenCalledWith('release_owner_alert', { p_user_id: 'user-1', p_dedup_key: 'publish:slot-1' });
    expect(logger.error).toHaveBeenCalledWith('[OWNER_ALERT] Resend rejected the email', expect.any(Error));
  });

  it('releases the claim and never raises when the send throws', async () => {
    const { deps, rpc } = build();
    deps.fetch = vi.fn(async () => {
      throw new TypeError('network down');
    });
    await expect(notifyPublishFailed(FAILED, deps)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('release_owner_alert', expect.anything());
    expect(logger.error).toHaveBeenCalledWith('[OWNER_ALERT] send failed', expect.objectContaining({ message: 'TypeError' }));
  });

  it('still returns when the release itself fails after a send failure', async () => {
    const { deps, rpc } = build();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'claim_owner_alert') return { data: true, error: null };
      throw new Error('release down');
    });
    deps.fetch = vi.fn(async () => {
      throw new TypeError('network down');
    });
    await expect(notifyPublishFailed(FAILED, deps)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('[OWNER_ALERT] release failed', expect.any(Error));
  });

  it('logs a release rpc error', async () => {
    const { deps, rpc } = build({ email: null });
    rpc.mockImplementation(async (fn: string) =>
      fn === 'claim_owner_alert' ? { data: true, error: null } : { data: null, error: { message: 'cannot release' } },
    );
    await notifyPublishFailed(FAILED, deps);
    expect(logger.error).toHaveBeenCalledWith('[OWNER_ALERT] release failed', expect.objectContaining({ message: 'cannot release' }));
  });

  it('warns once and sends nothing when Resend is not configured', async () => {
    const { deps, rpc } = build();
    deps.env = { apiKey: '', from: '', appUrl: ENV.appUrl };
    vi.stubEnv('RESEND_API_KEY', undefined);
    vi.stubEnv('ACCOUNT_BREAK_FROM', undefined);
    await notifyPublishFailed(FAILED, deps);
    await notifyPublishFailed(FAILED, deps);
    expect(rpc).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('releases the claim when the owner lookup errors', async () => {
    const { deps, getUserById, rpc } = build();
    getUserById.mockResolvedValue({ data: null, error: new Error('auth down') });
    await notifyPublishFailed(FAILED, deps);
    expect(rpc).toHaveBeenCalledWith('release_owner_alert', expect.anything());
  });
});

describe('notifyPublishPartial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerMailWarningForTests();
  });

  it('lists each account that did not get the post under the partial dedup key', async () => {
    const { deps, rpc, fetchMock } = build();
    await notifyPublishPartial({ userId: 'user-1', slotId: 'slot-1', title: 'Porto', persona: 'Maya', failures: FAILED.failures }, deps);
    expect(rpc).toHaveBeenCalledWith('claim_owner_alert', { p_user_id: 'user-1', p_dedup_key: 'publish-partial:slot-1', p_window_days: null });
    const body = sentBody(fetchMock);
    expect(body.subject).toBe('A post did not reach every account');
    expect(body.text).toContain('These accounts did not get the post:');
    expect(body.text).toContain('YouTube — Maya Channel — token revoked');
  });

  it('sends nothing without failures, an owner or a slot', async () => {
    const { deps, rpc } = build();
    await notifyPublishPartial({ userId: 'user-1', slotId: 'slot-1', title: 'Porto', persona: null, failures: [] }, deps);
    await notifyPublishPartial({ userId: null, slotId: 'slot-1', title: 'Porto', persona: null, failures: FAILED.failures }, deps);
    await notifyPublishPartial({ userId: 'user-1', slotId: '', title: 'Porto', persona: null, failures: FAILED.failures }, deps);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the site origin when no app url is configured', async () => {
    const { deps, fetchMock } = build();
    deps.env = { ...ENV, appUrl: '' };
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
    await notifyPublishPartial({ userId: 'user-1', slotId: 'slot-1', title: 'Porto', persona: null, failures: FAILED.failures }, deps);
    expect(sentBody(fetchMock).text).toMatch(/Open the post: https?:\/\/[^\s]+\/posts\/slot-1/);
    vi.unstubAllEnvs();
  });
});
