import { PROVIDER_LABELS } from '@/lib/account-options';
import { isSocialProvider } from '@/lib/contracts/providers';
import { logger } from '@/lib/logger';
import { normalizeFrom } from '@/lib/owner-alert-mail';
import { scrubErrorText } from '@/lib/publisher/scrub-error';
import { isRecord } from '@/lib/publisher/types';
import { SITE_URL } from '@/lib/seo';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const RESEND_URL = 'https://api.resend.com/emails';
const USER_AGENT = 'post-engineer/owner-alert';
const REASON_CHARS = 300;
const TIMEOUT_MS = 10_000;

export interface PublishFailure {
  provider: string;
  accountId: string;
  reason: string;
}

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface MailDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
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
      eq(column: string, value: string): PromiseLike<QueryResult>;
    };
  };
}

export interface OwnerMailDeps {
  fetch?: typeof fetch;
  supabase?: MailDb;
  env?: { apiKey?: string; from?: string; appUrl?: string };
}

let missingConfigLogged = false;

function providerLabel(provider: string): string {
  return isSocialProvider(provider) ? PROVIDER_LABELS[provider] : provider;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(value: string): string {
  return value.replace(/\r/g, ' ').replace(/\n/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

function origin(deps: OwnerMailDeps | undefined): string {
  const configured = (deps?.env?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  return (configured === '' ? SITE_URL : configured).replace(/\/+$/, '');
}

function postLink(slotId: string, base: string): string {
  return `${base}/posts/${slotId}`;
}

function render(subject: string, bits: string[], links: Array<[string, string]>): { html: string; text: string } {
  const html = [
    '<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;font-family:Georgia,serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;"><tr><td>',
    '<p style="margin:0 0 8px;font-size:13px;color:#71717a;">Post Engineer</p>',
    `<h1 style="margin:0 0 16px;font-size:22px;color:#18181b;">${escapeHtml(subject)}</h1>`,
  ];
  const text = [subject, ''];
  for (const bit of bits) {
    const cleaned = clean(bit);
    if (cleaned === '') continue;
    html.push(`<p style="margin:0 0 12px;color:#18181b;">${escapeHtml(cleaned)}</p>`);
    text.push(cleaned);
  }
  text.push('');
  for (const [label, url] of links) {
    html.push(`<p style="margin:0 0 8px;"><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`);
    text.push(`${label}: ${url}`);
  }
  html.push('</td></tr></table></td></tr></table></body></html>');
  return { html: html.join(''), text: text.join('\n') };
}

function reasonText(reason: string, fallback: string): string {
  const cleaned = clean(scrubErrorText(reason, REASON_CHARS));
  return cleaned === '' ? fallback : cleaned;
}

function failureLines(failures: PublishFailure[], names: Map<string, string>): string[] {
  return failures.map((item) => {
    const label = providerLabel(item.provider);
    const who = names.get(`${item.provider}\u0000${item.accountId}`) ?? (item.accountId === '' ? label : item.accountId);
    const detail = reasonText(item.reason, '');
    return clean(detail === '' ? `${label} — ${who}` : `${label} — ${who} — ${detail}`);
  });
}

function configured(deps: OwnerMailDeps | undefined): { apiKey: string; from: string } | null {
  const apiKey = (deps?.env?.apiKey ?? process.env.RESEND_API_KEY ?? '').trim();
  const from = normalizeFrom(deps?.env?.from ?? process.env.ACCOUNT_BREAK_FROM);
  if (apiKey === '' || from === '') {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      logger.warn('[OWNER_ALERT] Resend is not configured');
    }
    return null;
  }
  return { apiKey, from };
}

async function lookupAccountNames(db: MailDb, userId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const { data, error } = await db
      .from('social_accounts')
      .select('provider, provider_account_id, account_name')
      .eq('user_id', userId);
    if (error !== null || !Array.isArray(data)) return names;
    for (const row of data) {
      if (!isRecord(row)) continue;
      const { provider, provider_account_id: account, account_name: name } = row;
      if (typeof provider === 'string' && typeof account === 'string' && typeof name === 'string' && name.trim() !== '') {
        names.set(`${provider}\u0000${account}`, name.trim());
      }
    }
  } catch (error) {
    logger.warn('[OWNER_ALERT] account lookup failed', { reason: error instanceof Error ? error.name : 'Error' });
  }
  return names;
}

async function releaseClaim(db: MailDb, userId: string, key: string): Promise<void> {
  const { error } = await db.rpc('release_owner_alert', { p_user_id: userId, p_dedup_key: key });
  if (error !== null) logger.error('[OWNER_ALERT] release failed', new Error(error.message ?? 'release failed'));
}

interface DeliveryInput {
  userId: string;
  dedupKey: string;
  subject: string;
  html: string;
  text: string;
}

async function deliver(db: MailDb, settings: { apiKey: string; from: string }, input: DeliveryInput, deps?: OwnerMailDeps): Promise<void> {
  const claimed = await db.rpc('claim_owner_alert', {
    p_user_id: input.userId,
    p_dedup_key: input.dedupKey,
    p_window_days: null,
  });
  if (claimed.error !== null) {
    logger.error('[OWNER_ALERT] claim failed', new Error(claimed.error.message ?? 'claim failed'));
    return;
  }
  if (claimed.data !== true) return;
  try {
    const user = await db.auth.admin.getUserById(input.userId);
    const email = user.data?.user?.email?.trim() ?? '';
    if (user.error !== null && user.error !== undefined) throw new Error('owner lookup failed');
    if (email === '') {
      await releaseClaim(db, input.userId, input.dedupKey);
      return;
    }
    const response = await (deps?.fetch ?? fetch)(RESEND_URL, {
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
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await releaseClaim(db, input.userId, input.dedupKey);
      logger.error('[OWNER_ALERT] Resend rejected the email', new Error(String(response.status)));
    }
  } catch (error) {
    try {
      await releaseClaim(db, input.userId, input.dedupKey);
    } catch (releaseError) {
      logger.error('[OWNER_ALERT] release failed', releaseError);
    }
    throw error;
  }
}

async function send(input: DeliveryInput, deps?: OwnerMailDeps): Promise<void> {
  try {
    const settings = configured(deps);
    if (settings === null) return;
    await deliver(deps?.supabase ?? createDefaultDb(), settings, input, deps);
  } catch (error) {
    logger.error('[OWNER_ALERT] send failed', new Error(error instanceof Error && error.name !== '' ? error.name : 'Error'));
  }
}

function createDefaultDb(): MailDb {
  return createSupabaseServiceClient() as unknown as MailDb;
}

export interface PublishFailedMail {
  userId: string | null;
  slotId: string;
  title: string;
  reason: string;
  persona: string | null;
  failures: PublishFailure[];
}

export async function notifyPublishFailed(mail: PublishFailedMail, deps?: OwnerMailDeps): Promise<void> {
  if (mail.userId === null || mail.slotId === '') return;
  const base = origin(deps);
  const subject = 'A post could not be published';
  const bits = [clean(mail.title) || 'A scheduled post'];
  if (mail.persona !== null && clean(mail.persona) !== '') bits.push(`Persona: ${clean(mail.persona)}`);
  bits.push(`What happened: ${reasonText(mail.reason, 'The post could not be published.')}`);
  if (mail.failures.length > 0) {
    const names = await lookupAccountNames(deps?.supabase ?? createDefaultDb(), mail.userId);
    bits.push(...failureLines(mail.failures, names));
  }
  const { html, text } = render(subject, bits, [
    ['Open the post', postLink(mail.slotId, base)],
    ['Reconnect accounts', `${base}/accounts`],
  ]);
  await send({ userId: mail.userId, dedupKey: `publish:${mail.slotId}`, subject, html, text }, deps);
}

export interface PublishPartialMail {
  userId: string | null;
  slotId: string;
  title: string;
  persona: string | null;
  failures: PublishFailure[];
}

export async function notifyPublishPartial(mail: PublishPartialMail, deps?: OwnerMailDeps): Promise<void> {
  if (mail.userId === null || mail.slotId === '') return;
  const names =
    mail.failures.length > 0 ? await lookupAccountNames(deps?.supabase ?? createDefaultDb(), mail.userId) : new Map<string, string>();
  const lines = failureLines(mail.failures, names);
  if (lines.length === 0) return;
  const base = origin(deps);
  const subject = 'A post did not reach every account';
  const bits = [clean(mail.title) || 'A scheduled post'];
  if (mail.persona !== null && clean(mail.persona) !== '') bits.push(`Persona: ${clean(mail.persona)}`);
  bits.push('These accounts did not get the post:', ...lines);
  const { html, text } = render(subject, bits, [
    ['Open the post', postLink(mail.slotId, base)],
    ['Reconnect accounts', `${base}/accounts`],
  ]);
  await send({ userId: mail.userId, dedupKey: `publish-partial:${mail.slotId}`, subject, html, text }, deps);
}

export function resetOwnerMailWarningForTests(): void {
  missingConfigLogged = false;
}
