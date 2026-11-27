import { PUBLISH_ACCOUNT_FIELDS, SOCIAL_PROVIDERS, isSocialProvider, type SocialProvider } from '@/lib/contracts/providers';
import { truncateBlueskyCaption } from '@/lib/bluesky';
import { FACEBOOK_TEXT_MAX_CHARS } from '@/lib/facebook';
import { PINTEREST_DESCRIPTION_MAX_CHARS, PINTEREST_TITLE_MAX_CHARS } from '@/lib/pinterest';
import { RUMBLE_TITLE_MAX_LENGTH } from '@/lib/rumble';
import { TELEGRAM_CAPTION_MAX_LENGTH } from '@/lib/telegram';
import { THREADS_TEXT_MAX_CHARS } from '@/lib/threads';
import { deriveTagsFromTitle, truncateChars } from '@/lib/publisher/text';
import type { PublishSchedule } from '@/lib/publisher/types';

const YOUTUBE_TITLE_MAX_CHARS = 100;
const INSTAGRAM_CAPTION_MAX_CHARS = 2200;
const LINKEDIN_CAPTION_MAX_CHARS = 3000;
const FANVUE_TITLE_MAX_CHARS = 100;
const FANVUE_DESCRIPTION_MAX_CHARS = 800;

export class PublishPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishPlanError';
  }
}

export class AccountNotBoundError extends PublishPlanError {
  constructor(message: string) {
    super(message);
    this.name = 'AccountNotBoundError';
  }
}

type PlanField = [name: string, value: string];

export interface ProviderPlan {
  provider: SocialProvider;
  fields: PlanField[];
  accountIds: string[];
}

interface PlanContext {
  title: string;
  copy: string;
  schedule: PublishSchedule;
  accountIds: string[];
}

interface ProviderSpec {
  fields: (ctx: PlanContext) => PlanField[];
  validate: (ctx: PlanContext) => void;
}

function aiLabelField(ctx: PlanContext): PlanField {
  return ['aiLabel', ctx.schedule.aiLabel ? 'true' : 'false'];
}

function ensure(condition: boolean, message: string): void {
  if (!condition) throw new PublishPlanError(message);
}

function validateAccounts(provider: string, ctx: PlanContext): void {
  ensure(ctx.accountIds.length > 0, `${provider} publish requires at least one account id`);
}

function accountsSpec(provider: string, fields: (ctx: PlanContext) => PlanField[]): ProviderSpec {
  return { fields, validate: (ctx) => validateAccounts(provider, ctx) };
}

const PROVIDER_SPECS: Record<SocialProvider, ProviderSpec> = {
  youtube: {
    fields: (ctx) => [
      ['title', truncateChars(ctx.title, YOUTUBE_TITLE_MAX_CHARS)],
      ['description', ctx.copy],
      ['privacyStatus', 'public'],
      aiLabelField(ctx),
      ['tags', deriveTagsFromTitle(ctx.title).join(',')],
    ],
    validate: (ctx) => {
      validateAccounts('youtube', ctx);
      ensure(truncateChars(ctx.title, YOUTUBE_TITLE_MAX_CHARS).trim() !== '', 'youtube publish requires a non-empty title');
      ensure(deriveTagsFromTitle(ctx.title).length > 0, 'youtube publish requires at least one tag');
    },
  },
  instagram: accountsSpec('instagram', (ctx) => [['caption', truncateChars(ctx.copy, INSTAGRAM_CAPTION_MAX_CHARS)], aiLabelField(ctx)]),
  bluesky: accountsSpec('bluesky', (ctx) => [['caption', truncateBlueskyCaption(ctx.copy)]]),
  linkedin: accountsSpec('linkedin', (ctx) => [['caption', truncateChars(ctx.copy, LINKEDIN_CAPTION_MAX_CHARS)]]),
  threads: accountsSpec('threads', (ctx) => [['caption', truncateChars(ctx.copy, THREADS_TEXT_MAX_CHARS)], aiLabelField(ctx)]),
  facebook: accountsSpec('facebook', (ctx) => [['caption', truncateChars(ctx.copy, FACEBOOK_TEXT_MAX_CHARS)], aiLabelField(ctx)]),
  pinterest: {
    fields: (ctx) => [
      ['title', truncateChars(ctx.title, PINTEREST_TITLE_MAX_CHARS)],
      ['description', truncateChars(ctx.copy, PINTEREST_DESCRIPTION_MAX_CHARS)],
      ['boardId', ctx.schedule.pinterestBoardId ?? ''],
      aiLabelField(ctx),
    ],
    validate: (ctx) => {
      validateAccounts('pinterest', ctx);
      ensure((ctx.schedule.pinterestBoardId ?? '').trim() !== '', 'pinterest publish requires a board id');
    },
  },
  '3speak': accountsSpec('3speak', (ctx) => [['caption', ctx.copy]]),
  rumble: {
    fields: (ctx) => [
      ['title', truncateChars(ctx.title, RUMBLE_TITLE_MAX_LENGTH)],
      ['description', ctx.copy],
    ],
    validate: (ctx) => {
      validateAccounts('rumble', ctx);
      ensure(truncateChars(ctx.title, RUMBLE_TITLE_MAX_LENGTH).trim() !== '', 'rumble publish requires a non-empty title');
    },
  },
  fanvue: {
    fields: (ctx) => [
      ['title', truncateChars(ctx.title, FANVUE_TITLE_MAX_CHARS)],
      ['description', truncateChars(ctx.copy, FANVUE_DESCRIPTION_MAX_CHARS)],
    ],
    validate: (ctx) => {
      validateAccounts('fanvue', ctx);
      ensure(truncateChars(ctx.title, FANVUE_TITLE_MAX_CHARS).trim() !== '', 'fanvue publish requires a non-empty title');
    },
  },
  telegram: accountsSpec('telegram', (ctx) => [['caption', truncateChars(ctx.copy, TELEGRAM_CAPTION_MAX_LENGTH)]]),
};

export function buildProviderPlan(
  provider: string,
  title: string,
  schedule: PublishSchedule,
  description: string,
  onlyAccounts: readonly string[] | null = null,
): ProviderPlan {
  const copy = description.trim();
  if (copy === '') throw new PublishPlanError('slot has no video description: the agent must send one');
  if (!isSocialProvider(provider)) throw new PublishPlanError(`unsupported schedule provider: ${provider}`);
  const real = onlyAccounts === null ? [] : onlyAccounts.filter((id) => id !== '');
  const accountIds = real.length > 0 ? real : schedule.accountIds[provider];
  const ctx: PlanContext = { title, copy, schedule, accountIds };
  const spec = PROVIDER_SPECS[provider];
  spec.validate(ctx);
  return {
    provider,
    fields: [...spec.fields(ctx), ...accountIds.map((id): PlanField => [PUBLISH_ACCOUNT_FIELDS[provider], id])],
    accountIds,
  };
}

export function validatePublishPlan(
  schedule: PublishSchedule,
  title: string,
  description: string,
  boundAccounts: Record<string, string[]> | null,
): void {
  if (schedule.providers.length === 0) throw new PublishPlanError('at least one publish provider is required');
  for (const provider of schedule.providers) {
    if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
      throw new PublishPlanError(`unsupported publish provider: ${provider}`);
    }
    const plan = buildProviderPlan(provider, title, schedule, description);
    if (boundAccounts === null) continue;
    const bound = boundAccounts[provider] ?? [];
    for (const accountId of plan.accountIds) {
      if (!bound.includes(accountId)) {
        throw new AccountNotBoundError(
          `account ${accountId} is not bound to persona ${schedule.personaId ?? ''}: ` +
            'bind it to the persona or remove it from the schedule',
        );
      }
    }
  }
}
