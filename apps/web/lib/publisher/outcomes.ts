import { PROVIDER_LABELS } from '@/lib/account-options';
import { isSocialProvider } from '@/lib/contracts/providers';
import {
  ATTEMPT_LEASE_SECONDS,
  MAX_PUBLISH_ATTEMPTS,
  PUBLISH_IN_PROGRESS_DELAY_SECONDS,
  PUBLISH_RETRY_DELAY_SECONDS,
} from '@/lib/publisher/constants';
import { scrubErrorText } from '@/lib/publisher/scrub-error';
import { attemptsOf, type AccountOutcome } from '@/lib/publisher/types';

const USER_CODES: readonly string[] = ['email_not_verified', 'token_expired', 'token_missing', 'disconnected'];
const NON_USER_CODES: readonly string[] = ['transient', 'publish_rejected', 'publish_in_progress'];
const LINK_FIELDS = ['videoUrl', 'permalink', 'postId'] as const;

export type OutcomeKey = `${string}\u0000${string}\u0000${string}`;

export function outcomeKey(provider: string, accountId: string, video: string): OutcomeKey {
  return `${provider}\u0000${accountId}\u0000${video}`;
}

export function nextDelaySeconds(attempts: number): number | null {
  if (attempts >= MAX_PUBLISH_ATTEMPTS) return null;
  const index = Math.max(attempts - 1, 0);
  return PUBLISH_RETRY_DELAY_SECONDS[Math.min(index, PUBLISH_RETRY_DELAY_SECONDS.length - 1)] ?? null;
}

export function leaseIso(now: Date): string {
  return new Date(now.getTime() + ATTEMPT_LEASE_SECONDS * 1000).toISOString();
}

function providerLabel(provider: string): string {
  return isSocialProvider(provider) ? PROVIDER_LABELS[provider] : provider;
}

export function userNotice(provider: string, code: string): string | null {
  const label = providerLabel(provider);
  if (code === 'email_not_verified') {
    return (
      `${label} did not publish because the email on this account is not verified. ` +
      `This is a problem with your account. Only you can fix it: verify the email on ${label}.`
    );
  }
  if (USER_CODES.includes(code)) {
    return (
      `${label} did not publish because the account needs to be reconnected. ` +
      `This is a problem with your account. Only you can fix it: reconnect ${label}.`
    );
  }
  if (code === 'publish_unknown') {
    return (
      `${label} may already have published this video, but the publish record was lost. ` +
      `Check ${label} before posting it again: this slot will not retry on its own.`
    );
  }
  return null;
}

function actionSentence(provider: string, code: string): string {
  const notice = userNotice(provider, code);
  if (notice !== null) return notice;
  const label = providerLabel(provider);
  if (code === 'retries_exhausted') return `${label} did not publish after ${MAX_PUBLISH_ATTEMPTS} attempts.`;
  return `${label} did not publish.`;
}

export function classifyFailure(errorCode: string | null): { code: string; requiresUser: boolean } {
  const code = errorCode === null ? '' : errorCode.trim();
  if (USER_CODES.includes(code) || code === 'publish_unknown') return { code, requiresUser: true };
  if (NON_USER_CODES.includes(code)) return { code, requiresUser: false };
  return { code: 'transient', requiresUser: false };
}

export function indexOutcomes(outcomes: AccountOutcome[]): Map<OutcomeKey, AccountOutcome> {
  const found = new Map<OutcomeKey, AccountOutcome>();
  for (const outcome of outcomes) found.set(outcomeKey(outcome.provider, outcome.accountId, outcome.video), outcome);
  return found;
}

export function isTerminal(outcome: AccountOutcome | undefined): boolean {
  if (outcome === undefined) return false;
  if (outcome.status === 'published') return true;
  if (outcome.status !== 'failed') return false;
  if (outcome.requiresUser) return true;
  if (outcome.code !== 'transient') return true;
  return attemptsOf(outcome) >= MAX_PUBLISH_ATTEMPTS;
}

export function hasLiveOutcome(outcomes: AccountOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.status === 'published' || outcome.status === 'retrying');
}

export function priorAttempts(
  outcome: AccountOutcome | undefined,
  slotAttempts: number,
  legacySlot: boolean,
): number {
  if (outcome !== undefined) return outcome.attempts === null ? slotAttempts : outcome.attempts;
  return legacySlot ? slotAttempts : 0;
}

export function isDue(outcome: AccountOutcome | undefined, now: Date): boolean {
  if (outcome === undefined) return true;
  if (outcome.status !== 'retrying') return !isTerminal(outcome);
  if (attemptsOf(outcome) >= MAX_PUBLISH_ATTEMPTS) return true;
  if (outcome.retryAt === null || outcome.retryAt === '') return true;
  const wake = Date.parse(outcome.retryAt);
  if (Number.isNaN(wake)) return true;
  return wake <= now.getTime();
}

export function exhaustOutcome(outcome: AccountOutcome): void {
  outcome.status = 'failed';
  outcome.code = 'retries_exhausted';
  outcome.requiresUser = false;
  outcome.notice = actionSentence(outcome.provider, 'retries_exhausted');
  outcome.retryAt = null;
}

export function failOutcome(outcome: AccountOutcome, message: string, errorCode: string | null, now: Date): void {
  outcome.error = scrubErrorText(message, 200);
  if (errorCode === 'publish_in_progress') {
    const waited = (outcome.inProgressWaitSeconds ?? 0) + PUBLISH_IN_PROGRESS_DELAY_SECONDS;
    if (waited >= ATTEMPT_LEASE_SECONDS) {
      outcome.requiresUser = true;
      outcome.status = 'failed';
      outcome.code = 'publish_unknown';
      outcome.notice = actionSentence(outcome.provider, 'publish_unknown');
      outcome.retryAt = null;
      return;
    }
    outcome.inProgressWaitSeconds = waited;
    outcome.requiresUser = false;
    outcome.status = 'retrying';
    outcome.code = 'publish_in_progress';
    outcome.notice = null;
    outcome.attempts = Math.max(attemptsOf(outcome) - 1, 0);
    outcome.retryAt = new Date(now.getTime() + PUBLISH_IN_PROGRESS_DELAY_SECONDS * 1000).toISOString();
    return;
  }
  const { code, requiresUser } = classifyFailure(errorCode);
  outcome.requiresUser = requiresUser;
  if (requiresUser || code !== 'transient') {
    outcome.status = 'failed';
    outcome.code = code;
    outcome.notice = actionSentence(outcome.provider, code);
    outcome.retryAt = null;
    return;
  }
  const attempts = attemptsOf(outcome);
  if (attempts >= MAX_PUBLISH_ATTEMPTS) {
    exhaustOutcome(outcome);
    return;
  }
  const delay = nextDelaySeconds(attempts);
  outcome.status = 'retrying';
  outcome.code = 'transient';
  outcome.requiresUser = false;
  outcome.notice = null;
  outcome.retryAt = new Date(now.getTime() + (delay ?? 0) * 1000).toISOString();
}

export function publishOutcome(outcome: AccountOutcome, source: Record<string, unknown>): void {
  outcome.status = 'published';
  outcome.code = null;
  outcome.requiresUser = false;
  outcome.notice = null;
  outcome.error = null;
  outcome.retryAt = null;
  for (const name of LINK_FIELDS) {
    const value = source[name];
    if (typeof value === 'string' && value !== '') outcome[name] = value;
  }
  const raw = source.warnings;
  const warnings = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
  if (warnings.length > 0) outcome.warnings = warnings;
  else delete outcome.warnings;
}

export function blankOutcome(provider: string, accountId: string, video: string, attempts: number): AccountOutcome {
  return {
    provider,
    accountId,
    video,
    status: 'retrying',
    attempts,
    code: 'transient',
    requiresUser: false,
    notice: null,
    error: null,
    retryAt: null,
  };
}

export function upsertOutcome(outcomes: AccountOutcome[], outcome: AccountOutcome): void {
  const index = outcomes.findIndex(
    (existing) =>
      existing.provider === outcome.provider &&
      existing.accountId === outcome.accountId &&
      existing.video === outcome.video,
  );
  if (index === -1) outcomes.push(outcome);
  else outcomes[index] = outcome;
}
