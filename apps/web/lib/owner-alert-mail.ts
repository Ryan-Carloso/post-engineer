import 'server-only';

import { PROVIDER_LABELS } from '@/lib/account-options';
import { classifyAccountBreak, type AccountBreakClass } from '@/lib/account-break';
import { logger } from '@/lib/logger';
import { SITE_URL } from '@/lib/seo';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { SocialProvider } from '@/lib/providers/registry';

//---------------
// owner-alert-mail — email the account owner when a connected account
// breaks (issue #558). Resend is called directly. A missing key or From
// address logs once and returns before any claim, so the request still
// succeeds and a later deploy can send.
//
// Dedup is claim_owner_alert (migration 059): one email per account per
// failure class per 7 days. A failed send releases the claim.
// The body uses fixed sentences. It never includes error.message or a token.
//---------------

const RESEND_URL = 'https://api.resend.com/emails';
const ACCOUNT_WINDOW_DAYS = 7;
const USER_AGENT = 'post-engineer/owner-alert';

const BREAK_COPY: Record<AccountBreakClass, string> = {
  token_undecryptable: 'The saved login is corrupted and cannot be read.',
  unauthorized: 'The provider rejected the login.',
  email_not_verified:
    'The provider says the account email is not verified. Verify it there, then disconnect and reconnect the account here.',
};

const FIX_COPY = 'Disconnect this account, then connect it again.';

export interface AccountBreakNotice {
  userId: string;
  provider: string;
  accountId: string;
  socialAccountId?: string;
  accountName?: string | null;
  error: unknown;
}

interface AlertDb {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  auth: {
    admin: {
      getUserById(id: string): PromiseLike<{
        data: { user: { email?: string | null } | null } | null;
        error: unknown;
      }>;
    };
  };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            maybeSingle(): PromiseLike<{
              data: { id?: string; account_name?: string | null } | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
}

export interface OwnerAlertDeps {
  fetch?: typeof fetch;
  supabase?: AlertDb;
  env?: { apiKey?: string; from?: string; appUrl?: string };
}

let missingConfigLogged = false;

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'Error';
}

function logFailure(error: unknown): void {
  logger.error('[OWNER_ALERT] send failed', new Error(errorName(error)));
}

export function normalizeFrom(raw: string | undefined): string {
  let value = (raw ?? '').trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function providerLabel(provider: string): string {
  if (Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider)) {
    return PROVIDER_LABELS[provider as SocialProvider];
  }
  return provider;
}

function appOrigin(env: OwnerAlertDeps['env']): string {
  const configured = (env?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return SITE_URL;
}

function dedupKey(notice: AccountBreakNotice, socialAccountId: string | undefined, kind: AccountBreakClass): string {
  const id = socialAccountId && socialAccountId.length > 0
    ? socialAccountId
    : `${notice.userId}:${notice.provider}:${notice.accountId}`;
  return `account:${id}:${kind}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function configured(deps: OwnerAlertDeps | undefined): { apiKey: string; from: string } | null {
  const apiKey = (deps?.env?.apiKey ?? process.env.RESEND_API_KEY ?? '').trim();
  const from = normalizeFrom(deps?.env?.from ?? process.env.ACCOUNT_BREAK_FROM);
  if (!apiKey || !from) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      logger.warn('[OWNER_ALERT] Resend is not configured');
    }
    return null;
  }
  return { apiKey, from };
}

async function lookupAccount(
  db: AlertDb,
  notice: AccountBreakNotice,
): Promise<{ id?: string; name: string | null }> {
  if (notice.socialAccountId) {
    return { id: notice.socialAccountId, name: notice.accountName ?? null };
  }
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, notice.provider)) {
    return { name: notice.accountName ?? null };
  }
  const { data, error } = await db
    .from('social_accounts')
    .select('id, account_name')
    .eq('user_id', notice.userId)
    .eq('provider', notice.provider)
    .eq('provider_account_id', notice.accountId)
    .maybeSingle();
  if (error || !data) return { name: notice.accountName ?? null };
  return { id: data.id, name: data.account_name ?? notice.accountName ?? null };
}

function renderAccountEmail(label: string, accountName: string | null, kind: AccountBreakClass, accountsUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Reconnect your ${oneLine(label)} account`;
  const name = oneLine(accountName ?? label);
  const broke = BREAK_COPY[kind];
  const html = [
    '<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;font-family:Georgia,serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;"><tr><td>',
    '<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;color:#71717a;">Post Engineer</p>',
    `<h1 style="margin:0 0 16px;font-size:22px;color:#18181b;">${escapeHtml(subject)}</h1>`,
    `<p style="margin:0 0 16px;color:#3f3f46;">${escapeHtml(name)}</p>`,
    '<p style="margin:0 0 4px;font-size:13px;color:#71717a;">What broke</p>',
    `<p style="margin:0 0 16px;color:#18181b;">${escapeHtml(broke)}</p>`,
    '<p style="margin:0 0 4px;font-size:13px;color:#71717a;">Fix</p>',
    `<p style="margin:0 0 24px;color:#18181b;">${escapeHtml(FIX_COPY)}</p>`,
    `<a href="${escapeHtml(accountsUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;">Open accounts</a>`,
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
  const text = [
    subject,
    '',
    name,
    '',
    `What broke: ${broke}`,
    `Fix: ${FIX_COPY}`,
    accountsUrl,
  ].join('\n');
  return { subject, html, text };
}

async function release(db: AlertDb, userId: string, key: string): Promise<void> {
  const { error } = await db.rpc('release_owner_alert', { p_user_id: userId, p_dedup_key: key });
  if (error) logFailure(error);
}

export async function notifyAccountBreak(notice: AccountBreakNotice, deps?: OwnerAlertDeps): Promise<void> {
  let db: AlertDb | null = null;
  let claimedKey: string | null = null;
  try {
    const kind = classifyAccountBreak(notice.error);
    if (kind === null) return;
    const settings = configured(deps);
    if (!settings) return;
    if (!UUID_RE.test(notice.userId)) {
      logFailure(new Error('BadUserId'));
      return;
    }
    db = deps?.supabase ?? (createSupabaseServiceClient() as unknown as AlertDb);
    const account = await lookupAccount(db, notice);
    const key = dedupKey(notice, account.id, kind);
    const claimed = await db.rpc('claim_owner_alert', {
      p_user_id: notice.userId,
      p_dedup_key: key,
      p_window_days: ACCOUNT_WINDOW_DAYS,
    });
    if (claimed.error) {
      logFailure(claimed.error);
      return;
    }
    if (claimed.data !== true) return;
    claimedKey = key;
    const user = await db.auth.admin.getUserById(notice.userId);
    const email = user.data?.user?.email?.trim() ?? '';
    if (user.error || !email) {
      await release(db, notice.userId, key);
      claimedKey = null;
      return;
    }
    const accountsUrl = `${appOrigin(deps?.env)}/accounts`;
    const message = renderAccountEmail(providerLabel(notice.provider), account.name, kind, accountsUrl);
    const send = deps?.fetch ?? fetch;
    const response = await send(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        from: settings.from,
        to: [email],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await release(db, notice.userId, key);
      claimedKey = null;
      logger.error('[OWNER_ALERT] Resend rejected the email', new Error(String(response.status)));
    }
  } catch (error) {
    if (db && claimedKey) {
      try {
        await release(db, notice.userId, claimedKey);
      } catch (releaseError) {
        logFailure(releaseError);
      }
    }
    logFailure(error);
  }
}
