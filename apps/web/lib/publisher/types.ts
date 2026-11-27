import { SCHEDULE_ACCOUNT_COLUMNS, SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';

export interface AccountOutcome {
  provider: string;
  accountId: string;
  video: string;
  status: string;
  attempts: number | null;
  code: string | null;
  requiresUser: boolean;
  notice: string | null;
  error: string | null;
  retryAt: string | null;
  inProgressWaitSeconds?: number;
  videoUrl?: string;
  permalink?: string;
  postId?: string;
  warnings?: string[];
}

export interface PublishSchedule {
  id: string | null;
  userId: string | null;
  personaId: string | null;
  providers: string[];
  accountIds: Record<SocialProvider, string[]>;
  pinterestBoardId: string | null;
  personaName: string | null;
  aiLabel: boolean;
}

export interface PublishSlot {
  id: string;
  userId: string | null;
  title: string | null;
  description: string | null;
  firstComment: string | null;
  mediaKind: string | null;
  mediaRef: string | null;
  mediaContentType: string | null;
  mediaClaimedAt: string | null;
  outcomes: AccountOutcome[];
  attempts: number;
  resumed: boolean;
  schedule: PublishSchedule;
}

export type MediaCleanup = { bucket: string; path: string } | null;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function attemptsOf(outcome: { attempts: number | null }): number {
  const value = outcome.attempts;
  return value === null ? 0 : Math.trunc(value);
}

function parseOutcome(item: Record<string, unknown>): AccountOutcome {
  const outcome: AccountOutcome = {
    provider: typeof item.provider === 'string' ? item.provider : '',
    accountId: typeof item.accountId === 'string' ? item.accountId : '',
    video: typeof item.video === 'string' ? item.video : '',
    status: typeof item.status === 'string' ? item.status : '',
    attempts: typeof item.attempts === 'number' && Number.isFinite(item.attempts) ? item.attempts : null,
    code: typeof item.code === 'string' ? item.code : null,
    requiresUser: item.requiresUser === true,
    notice: typeof item.notice === 'string' ? item.notice : null,
    error: typeof item.error === 'string' ? item.error : null,
    retryAt: typeof item.retryAt === 'string' ? item.retryAt : null,
  };
  if (typeof item.inProgressWaitSeconds === 'number') outcome.inProgressWaitSeconds = item.inProgressWaitSeconds;
  if (typeof item.videoUrl === 'string') outcome.videoUrl = item.videoUrl;
  if (typeof item.permalink === 'string') outcome.permalink = item.permalink;
  if (typeof item.postId === 'string') outcome.postId = item.postId;
  const warnings = stringList(item.warnings);
  if (warnings.length > 0) outcome.warnings = warnings;
  return outcome;
}

export function loadOutcomes(raw: unknown): AccountOutcome[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map(parseOutcome);
}

function parseSchedule(raw: unknown): PublishSchedule {
  const row = isRecord(raw) ? raw : {};
  const personas = isRecord(row.personas) ? row.personas : null;
  const accountIds = {} as Record<SocialProvider, string[]>;
  for (const provider of SOCIAL_PROVIDERS) {
    accountIds[provider] = stringList(row[SCHEDULE_ACCOUNT_COLUMNS[provider]]).filter((id) => id !== '');
  }
  return {
    id: optionalString(row.id),
    userId: optionalString(row.user_id),
    personaId: optionalString(row.persona_id),
    providers: stringList(row.providers),
    accountIds,
    pinterestBoardId: optionalString(row.pinterest_board_id),
    personaName: personas === null ? null : optionalString(personas.name),
    aiLabel: personas !== null && personas.ai_label === true,
  };
}

export function parseClaimedSlot(raw: unknown): PublishSlot {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') {
    throw new Error('claim_next_publish_slot returned a row without an id');
  }
  const schedule = parseSchedule(raw.schedules);
  return {
    id: raw.id,
    userId: optionalString(raw.user_id) ?? schedule.userId,
    title: optionalString(raw.title),
    description: optionalString(raw.description),
    firstComment: optionalString(raw.first_comment),
    mediaKind: optionalString(raw.media_kind),
    mediaRef: optionalString(raw.media_ref),
    mediaContentType: optionalString(raw.media_content_type),
    mediaClaimedAt: optionalString(raw.media_claimed_at),
    outcomes: loadOutcomes(raw.publish_outcomes),
    attempts: typeof raw.publish_attempts === 'number' ? raw.publish_attempts : 0,
    resumed: raw.resumed === true,
    schedule,
  };
}
