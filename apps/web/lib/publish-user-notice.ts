import { PROVIDER_LABELS } from '@/lib/account-options';
import { isUserAccountErrorCode, type UserAccountErrorCode } from '@/lib/upload/account-error-codes';

export type PublishUserNoticeCode = UserAccountErrorCode | TerminalUserActionCode;

export interface PublishUserNotice {
  provider: string;
  accountId: string;
  code: PublishUserNoticeCode;
  requiresUser: true;
  notice: string;
}

const TERMINAL_USER_ACTION_CODES = ['publish_unknown'] as const;
type TerminalUserActionCode = (typeof TERMINAL_USER_ACTION_CODES)[number];

function isUserActionCode(code: string): code is PublishUserNoticeCode {
  return (
    isUserAccountErrorCode(code) || (TERMINAL_USER_ACTION_CODES as readonly string[]).includes(code)
  );
}

export interface PublishProviderFailure {
  provider: string;
  accountId: string;
  code: string;
  requiresUser: boolean;
  notice: string;
}

export function providerLabel(provider: string): string {
  const match = Object.entries(PROVIDER_LABELS).find(([key]) => key === provider);
  return match === undefined ? provider : match[1];
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
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row: Record<string, unknown> = { ...item };
    if (row.status !== 'failed') continue;
    const provider = textOf(row.provider);
    const accountId = textOf(row.accountId);
    const code = textOf(row.code);
    const key = `${provider}:${accountId}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const notice = failureNotice(provider, code, textOf(row.notice));
    if (row.requiresUser === true && isUserActionCode(code)) {
      userNotices.push({ provider, accountId, code, requiresUser: true, notice });
      providerFailures.push({ provider, accountId, code, requiresUser: true, notice });
    } else {
      providerFailures.push({ provider, accountId, code, requiresUser: false, notice });
    }
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

export const USER_NOTICE_OUTCOME_FILTER = JSON.stringify([{ requiresUser: true }]);

function slotAtOf(row: Record<string, unknown>): string {
  return textOf(row.slot_at);
}

export function mergeBySlotAt(
  first: Record<string, unknown>[],
  second: Record<string, unknown>[],
  limit: number,
): Record<string, unknown>[] {
  return [...first, ...second]
    .sort((a, b) => (slotAtOf(a) < slotAtOf(b) ? -1 : slotAtOf(a) > slotAtOf(b) ? 1 : 0))
    .slice(0, limit);
}

export function presentPublishRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  const presented: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    presented.push(presentPublishRow({ ...row }));
  }
  return presented;
}
