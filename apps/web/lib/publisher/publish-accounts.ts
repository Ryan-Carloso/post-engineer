import { isSocialProvider } from '@/lib/contracts/providers';
import { appendFirstComment } from '@/lib/first-comment/form-field';
import { logger } from '@/lib/logger';
import type { PublishContentInput, PublishContentRejected, PublishContentResult } from '@/lib/upload/publish-content';
import { targetsFromResults } from '@/lib/publisher/account-results';
import { MAX_PUBLISH_ATTEMPTS, PUBLISH_CALL_TIMEOUT_MS } from '@/lib/publisher/constants';
import {
  blankOutcome,
  exhaustOutcome,
  failOutcome,
  indexOutcomes,
  isDue,
  isTerminal,
  leaseIso,
  outcomeKey,
  priorAttempts,
  publishOutcome,
  upsertOutcome,
} from '@/lib/publisher/outcomes';
import { PublishPlanError, buildProviderPlan, type ProviderPlan } from '@/lib/publisher/plan';
import { diagnosticOf, errorMessageOf } from '@/lib/publisher/scrub-error';
import { attemptsOf, type AccountOutcome, type PublishSlot } from '@/lib/publisher/types';

export type PublishFn = (input: PublishContentInput) => Promise<PublishContentResult>;

type PersistOutcomes = (outcomes: AccountOutcome[], fields: Record<string, unknown>) => Promise<void>;

export interface SlotMedia {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export interface ProviderFailure {
  provider: string;
  status: number | null;
  message: string;
}

export interface AccountPublishResult {
  outcomes: AccountOutcome[];
  publishedProviders: string[];
  failedProviders: string[];
  nonUserFailedProviders: string[];
  firstError: string;
  maxAttempts: number;
  anyRetrying: boolean;
  anyPublished: boolean;
  newUserNotices: string[];
  providerFailures: ProviderFailure[];
  failureReason: string;
}

export interface PublishAccountsInput {
  slot: PublishSlot;
  media: SlotMedia;
  title: string;
  description: string;
  publish: PublishFn;
  persistOutcomes: PersistOutcomes;
  clock: () => Date;
  logId: string;
}

function accountIdsFor(provider: string, slot: PublishSlot): string[] {
  const ids = isSocialProvider(provider) ? slot.schedule.accountIds[provider] : [];
  return ids.length > 0 ? ids : [''];
}

function buildForm(plan: ProviderPlan, media: SlotMedia, firstComment: string | null): FormData {
  const form = new FormData();
  for (const [name, value] of plan.fields) form.append(name, value);
  appendFirstComment(form, plan.provider, firstComment);
  const fileField = plan.provider === 'instagram' ? 'file' : 'video';
  form.append(fileField, new File([media.bytes], media.name, { type: media.contentType }));
  return form;
}

function timedOut(): PublishContentRejected {
  const error = `publish timed out after ${Math.round(PUBLISH_CALL_TIMEOUT_MS / 60_000)} minutes`;
  return { ok: false, status: 504, errorCode: 'transient', error, cause: new Error(error) };
}

async function publishWithTimeout(publish: PublishFn, input: PublishContentInput): Promise<PublishContentResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PublishContentResult>((resolve) => {
    timer = setTimeout(() => resolve(timedOut()), PUBLISH_CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([publish(input), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function maxAttemptsOf(outcomes: AccountOutcome[]): number {
  return outcomes.reduce((max, item) => Math.max(max, attemptsOf(item)), 0);
}

function summarize(
  result: AccountPublishResult,
  alreadyUser: Set<string>,
): void {
  const published: string[] = [];
  const failed: string[] = [];
  const nonUser: string[] = [];
  for (const outcome of result.outcomes) {
    const provider = outcome.provider;
    if (outcome.status === 'published') {
      result.anyPublished = true;
      if (!published.includes(provider)) published.push(provider);
    } else if (outcome.status === 'retrying') {
      result.anyRetrying = true;
      if (!failed.includes(provider)) failed.push(provider);
    } else if (outcome.status === 'failed') {
      if (!failed.includes(provider)) failed.push(provider);
      if (!outcome.requiresUser && !nonUser.includes(provider)) nonUser.push(provider);
    }
    const key = outcomeKey(provider, outcome.accountId, outcome.video);
    if (outcome.requiresUser && !alreadyUser.has(key) && outcome.notice !== null) {
      result.newUserNotices.push(outcome.notice);
    }
  }
  result.publishedProviders = published;
  result.failedProviders = failed;
  result.nonUserFailedProviders = nonUser;
  result.maxAttempts = maxAttemptsOf(result.outcomes);
  const names = failed.join(', ') || 'unknown';
  const detail = result.firstError === '' ? '' : `: ${result.firstError}`;
  if (!result.anyPublished) result.failureReason = `all providers failed: ${names}${detail}`;
  else if (result.anyRetrying) result.failureReason = `some accounts still retrying: ${names}${detail}`;
}

export async function publishSlotAccounts(input: PublishAccountsInput): Promise<AccountPublishResult> {
  const { slot, media, title, description, publish, persistOutcomes, clock, logId } = input;
  const outcomes = slot.outcomes;
  const legacySlot = outcomes.length === 0;
  const indexed = indexOutcomes(outcomes);
  const alreadyUser = new Set<string>();
  for (const [key, outcome] of indexed) if (outcome.requiresUser) alreadyUser.add(key);
  const result: AccountPublishResult = {
    outcomes,
    publishedProviders: [],
    failedProviders: [],
    nonUserFailedProviders: [],
    firstError: '',
    maxAttempts: 0,
    anyRetrying: false,
    anyPublished: false,
    newUserNotices: [],
    providerFailures: [],
    failureReason: '',
  };
  const noteError = (message: string): void => {
    if (result.firstError === '') result.firstError = message;
  };

  for (const provider of slot.schedule.providers) {
    const key = (accountId: string) => outcomeKey(provider, accountId, media.name);
    const pending = accountIdsFor(provider, slot).filter(
      (accountId) => !isTerminal(indexed.get(key(accountId))) && isDue(indexed.get(key(accountId)), clock()),
    );
    if (pending.length === 0) continue;

    const started: AccountOutcome[] = [];
    for (const accountId of pending) {
      const prior = indexed.get(key(accountId));
      if (prior !== undefined && prior.status === 'retrying' && attemptsOf(prior) >= MAX_PUBLISH_ATTEMPTS) {
        exhaustOutcome(prior);
        upsertOutcome(outcomes, prior);
        continue;
      }
      const attempt = priorAttempts(prior, slot.attempts, legacySlot) + 1;
      const outcome = blankOutcome(provider, accountId, media.name, attempt);
      if (prior !== undefined && prior.inProgressWaitSeconds !== undefined) {
        outcome.inProgressWaitSeconds = prior.inProgressWaitSeconds;
      }
      upsertOutcome(outcomes, outcome);
      indexed.set(key(accountId), outcome);
      started.push(outcome);
    }
    if (started.length === 0) continue;

    await persistOutcomes(outcomes, {
      status: 'publishing',
      publish_attempts: maxAttemptsOf(outcomes),
      publish_not_before: leaseIso(clock()),
    });

    const startedIds = started.map((item) => item.accountId);
    let plan: ProviderPlan;
    try {
      plan = buildProviderPlan(provider, title, slot.schedule, description, startedIds);
    } catch (error) {
      if (!(error instanceof PublishPlanError)) throw error;
      for (const outcome of started) failOutcome(outcome, error.message, 'publish_rejected', clock());
      noteError(error.message);
      await persistOutcomes(outcomes, { publish_attempts: maxAttemptsOf(outcomes) });
      continue;
    }

    const form = buildForm(plan, media, slot.firstComment);
    let publishResult: PublishContentResult;
    try {
      publishResult = await publishWithTimeout(publish, {
        provider: plan.provider,
        userId: slot.userId ?? slot.schedule.userId ?? '',
        formData: form,
        scopeKeyRaw: `slot:${slot.id}:video:${media.name}`,
        logId,
        startTime: Date.now(),
      });
    } catch (error) {
      const message = errorMessageOf(error);
      for (const outcome of started) failOutcome(outcome, message, null, clock());
      result.providerFailures.push({ provider, status: null, message });
      noteError(message);
      logger.error('[publisher] publish call threw', error, { slotId: slot.id, provider });
      await persistOutcomes(outcomes, { publish_attempts: maxAttemptsOf(outcomes) });
      continue;
    }

    if (!publishResult.ok) {
      for (const outcome of started) failOutcome(outcome, publishResult.error, publishResult.errorCode, clock());
      result.providerFailures.push({ provider, status: publishResult.status, message: publishResult.error });
      noteError(publishResult.error);
      logger.warn('[publisher] provider publish rejected', {
        slotId: slot.id,
        provider,
        status: publishResult.status,
        reason: diagnosticOf(publishResult.cause),
      });
    } else {
      const targets = targetsFromResults(startedIds, publishResult.response.results);
      for (const outcome of started) {
        const target = targets.get(outcome.accountId);
        if (target !== undefined && target.kind === 'published') {
          publishOutcome(outcome, target.source);
          continue;
        }
        const source = target === undefined ? {} : target.source;
        const message = typeof source.error === 'string' && source.error !== '' ? source.error : 'publish reported account failure';
        const code = typeof source.errorCode === 'string' ? source.errorCode : null;
        failOutcome(outcome, message, code, clock());
      }
    }
    await persistOutcomes(outcomes, { publish_attempts: maxAttemptsOf(outcomes) });
  }

  summarize(result, alreadyUser);
  return result;
}
