import 'server-only';

import { normalizeFrom } from '@/lib/owner-alert-mail';
import { logger } from '@/lib/logger';
import { SITE_URL } from '@/lib/seo';
import { readReviewerIds } from '@/lib/prompt-reviewers';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const RESEND_URL = 'https://api.resend.com/emails';
const USER_AGENT = 'post-engineer/prompt-review';
const SEND_TIMEOUT_MS = 10_000;

export interface PendingPromptNotice {
  slug: string;
  title: string;
}

export interface PromptReviewMailDeps {
  fetchFn?: typeof fetch;
  loadRecipients?: () => Promise<string[]>;
  env?: { apiKey?: string; from?: string };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  return configured.length > 0 ? configured.replace(/\/+$/, '') : SITE_URL;
}

async function loadReviewerEmails(): Promise<string[]> {
  const db = createSupabaseServiceClient();
  const emails: string[] = [];
  for (const reviewerId of readReviewerIds()) {
    const { data, error } = await db.auth.admin.getUserById(reviewerId);
    if (error !== null || data.user === null) {
      logger.warn('[prompt-review-mail] reviewer lookup failed', { reviewerId });
      continue;
    }
    if (typeof data.user.email === 'string' && data.user.email.length > 0) emails.push(data.user.email);
  }
  return emails;
}

export function renderPendingPromptEmail(notice: PendingPromptNotice, reviewUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  const title = oneLine(notice.title);
  const subject = `Prompt waiting for review: ${title}`;
  const text = [subject, '', `Slug: ${notice.slug}`, '', `Review it: ${reviewUrl}`].join('\n');
  const html = [
    '<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;font-family:Georgia,serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;"><tr><td>',
    '<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;color:#71717a;">Post Engineer</p>',
    `<h1 style="margin:0 0 16px;font-size:22px;color:#18181b;">${escapeHtml(subject)}</h1>`,
    `<p style="margin:0 0 24px;color:#3f3f46;">Slug: ${escapeHtml(notice.slug)}</p>`,
    `<a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;">Open the review queue</a>`,
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
  return { subject, html, text };
}

export async function notifyReviewersOfPendingPrompt(
  notice: PendingPromptNotice,
  deps?: PromptReviewMailDeps,
): Promise<void> {
  const apiKey = (deps?.env?.apiKey ?? process.env.RESEND_API_KEY ?? '').trim();
  const from = normalizeFrom(deps?.env?.from ?? process.env.ACCOUNT_BREAK_FROM);
  if (apiKey.length === 0 || from.length === 0) return;
  try {
    const recipients = await (deps?.loadRecipients ?? loadReviewerEmails)();
    if (recipients.length === 0) return;
    const message = renderPendingPromptEmail(notice, `${appOrigin()}/admin/prompts`);
    const send = deps?.fetchFn ?? fetch;
    const response = await send(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ from, to: recipients, subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('[prompt-review-mail] Resend rejected the email', { status: response.status, slug: notice.slug });
    }
  } catch (error) {
    logger.warn('[prompt-review-mail] email failed', { slug: notice.slug, error: error instanceof Error ? error.name : 'unknown' });
  }
}
