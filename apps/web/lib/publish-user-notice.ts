// Per-account publish notices (issue #500). The slot row keeps the raw
// outcomes; callers show userNotices and providerFailures and drop the rest.

export interface PublishUserNotice {
  provider: string;
  accountId: string;
  code: string;
  requiresUser: true;
  notice: string;
}

export interface PublishProviderFailure {
  provider: string;
  accountId: string;
  code: string;
  requiresUser: false;
  notice: string;
}

const USER_CODES = new Set(['email_not_verified', 'token_expired', 'token_missing', 'disconnected']);

const LABELS: Record<string, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  threads: 'Threads',
};

export function providerLabel(provider: string): string {
  return LABELS[provider] ?? provider;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function failureNotice(provider: string, code: string, stored: string): string {
  if (stored) return stored;
  const label = providerLabel(provider);
  if (code === 'retries_exhausted') return `${label} did not publish after 3 attempts.`;
  return `${label} did not publish.`;
}

export function noticesFromOutcomes(raw: unknown): {
  userNotices: PublishUserNotice[];
  providerFailures: PublishProviderFailure[];
} {
  const userNotices: PublishUserNotice[] = [];
  const providerFailures: PublishProviderFailure[] = [];
  if (!Array.isArray(raw)) return { userNotices, providerFailures };
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (row.status !== 'failed') continue;
    const provider = textOf(row.provider);
    const accountId = textOf(row.accountId);
    const code = textOf(row.code);
    const notice = failureNotice(provider, code, textOf(row.notice));
    if (row.requiresUser === true && USER_CODES.has(code)) {
      userNotices.push({ provider, accountId, code, requiresUser: true, notice });
    }
    providerFailures.push({ provider, accountId, code, requiresUser: false, notice });
  }
  return { userNotices, providerFailures };
}

export function presentPublishRow(row: Record<string, unknown>): Record<string, unknown> {
  const { publish_outcomes: outcomes, ...rest } = row;
  const { userNotices, providerFailures } = noticesFromOutcomes(outcomes);
  if (userNotices.length > 0) rest.userNotices = userNotices;
  if (providerFailures.length > 0) rest.providerFailures = providerFailures;
  return rest;
}

export function presentPublishRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  const presented: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    presented.push(presentPublishRow(row as Record<string, unknown>));
  }
  return presented;
}

export function publishingWithUserNotice(rows: unknown): Record<string, unknown>[] {
  return presentPublishRows(rows).filter(
    (row) => row.status === 'publishing' && Array.isArray(row.userNotices) && row.userNotices.length > 0,
  );
}
