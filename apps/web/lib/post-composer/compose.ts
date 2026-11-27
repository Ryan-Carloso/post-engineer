import {
  IMAGE_PROVIDERS,
  SOCIAL_PROVIDERS,
  isImageProvider,
  type SocialProvider,
} from '@/lib/contracts/providers';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  isImageUploadContentType,
} from '@/lib/contracts/upload-types';
import {
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_MIN_ADVANCE_HOURS,
  validateScheduleWindow,
} from '@/lib/schedule-window';
import { isValidTimezone, parseZonedDateTime, utcToZonedInputValue } from '@/lib/timezone';

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 5000;

export type ComposerMediaKind = 'video' | 'image';
export type ComposerMode = 'asap' | 'scheduled';
export type ComposerPrivacy = 'public' | 'unlisted' | 'private';
export type MediaContentType =
  | 'video/mp4'
  | 'video/quicktime'
  | 'image/jpeg'
  | 'image/png';

const MEDIA_CONTENT_TYPES: readonly MediaContentType[] = [
  'video/mp4',
  'video/quicktime',
  'image/jpeg',
  'image/png',
];

const EXTENSION_CONTENT_TYPES: Record<string, MediaContentType> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export type ComposerField =
  | 'media'
  | 'accounts'
  | 'persona'
  | 'title'
  | 'description'
  | 'tags'
  | 'board'
  | 'schedule';

type ComposerIssueKey =
  | 'composer.validationMedia'
  | 'composer.validationMediaType'
  | 'composer.validationAccounts'
  | 'composer.validationPersonaAccounts'
  | 'composer.validationImageProviders'
  | 'composer.validationTitle'
  | 'composer.validationTitleLong'
  | 'composer.validationDescription'
  | 'composer.validationDescriptionLong'
  | 'composer.validationTags'
  | 'composer.validationBoard'
  | 'composer.validationPinterestSingle'
  | 'composer.validationSchedule'
  | 'composer.validationTimezone';

export interface ComposerIssue {
  field: ComposerField;
  key: ComposerIssueKey;
  vars?: Record<string, string | number>;
}

export interface ComposerDraft {
  mediaKind: ComposerMediaKind | null;
  accounts: Partial<Record<SocialProvider, string[]>>;
  personaId: string | null;
  title: string;
  description: string;
  caption: string;
  tags: string;
  privacyStatus: ComposerPrivacy;
  firstComment: string;
  pinterestBoardId: string;
  mode: ComposerMode;
  publishAt: string;
  timezone: string;
}

export interface SubmissionPlan {
  mode: ComposerMode;
  providers: SocialProvider[];
  accounts: Record<string, string[]>;
  title: string;
  description: string;
  caption: string | null;
  tags: string[] | undefined;
  privacyStatus: string | undefined;
  firstComment: string | null;
  personaId: string | null;
  pinterestBoardId: string | null;
  schedule: { publishAt: string; timezone: string } | null;
}

export type BuildSubmissionResult =
  | { ok: true; plan: SubmissionPlan }
  | { ok: false; issues: ComposerIssue[] };

export interface BuildSubmissionOptions {
  now: Date;
  boundAccounts: Record<SocialProvider, string[]> | null;
}

export function resolveMediaContentType(file: { type: string; name: string }): MediaContentType | null {
  if ((MEDIA_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as MediaContentType;
  }
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

export function mediaKindOf(contentType: MediaContentType): ComposerMediaKind {
  return isImageUploadContentType(contentType) ? 'image' : 'video';
}

export function mediaMaxBytes(contentType: MediaContentType): number {
  return mediaKindOf(contentType) === 'image' ? MAX_IMAGE_UPLOAD_BYTES : MAX_VIDEO_UPLOAD_BYTES;
}

export function providersForMedia(kind: ComposerMediaKind | null): readonly SocialProvider[] {
  return kind === 'image' ? IMAGE_PROVIDERS : SOCIAL_PROVIDERS;
}

export function selectedProviders(
  accounts: Partial<Record<SocialProvider, string[]>>,
): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((provider) => (accounts[provider]?.length ?? 0) > 0);
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim();
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function createDraft(timezone: string): ComposerDraft {
  return {
    mediaKind: null,
    accounts: {},
    personaId: null,
    title: '',
    description: '',
    caption: '',
    tags: '',
    privacyStatus: 'public',
    firstComment: '',
    pinterestBoardId: '',
    mode: 'scheduled',
    publishAt: '',
    timezone,
  };
}

export function defaultPublishAt(now: Date, timezone: string): string {  const target = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return utcToZonedInputValue(target.toISOString(), timezone)?.slice(0, 16) ?? '';
}

export function publishAtBounds(now: Date, timezone: string): { min: string; max: string } {
  const min = new Date(now.getTime() + SCHEDULE_MIN_ADVANCE_HOURS * 60 * 60 * 1000);
  const max = new Date(now.getTime() + SCHEDULE_MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000);
  return {
    min: utcToZonedInputValue(min.toISOString(), timezone)?.slice(0, 16) ?? '',
    max: utcToZonedInputValue(max.toISOString(), timezone)?.slice(0, 16) ?? '',
  };
}

export function browserTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone === undefined || timezone === '' ? 'UTC' : timezone;
  } catch {
    return 'UTC';
  }
}

export const TIMEZONES: readonly string[] = (() => {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC'];
  }
})();

function effectiveAccounts(
  draft: ComposerDraft,
  bound: Record<SocialProvider, string[]> | null,
): Partial<Record<SocialProvider, string[]>> {
  const effective: Partial<Record<SocialProvider, string[]>> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const ids = draft.accounts[provider] ?? [];
    const allowed = bound === null ? ids : ids.filter((id) => bound[provider].includes(id));
    if (allowed.length > 0) effective[provider] = allowed;
  }
  return effective;
}

function countBoundAccounts(bound: Record<SocialProvider, string[]>): number {
  let total = 0;
  for (const provider of SOCIAL_PROVIDERS) total += bound[provider].length;
  return total;
}

export function buildSubmission(
  draft: ComposerDraft,
  options: BuildSubmissionOptions,
): BuildSubmissionResult {
  const issues: ComposerIssue[] = [];
  const title = draft.title.trim();
  const description = draft.description.trim();
  const caption = draft.caption.trim();
  const tags = parseTags(draft.tags);

  if (draft.mediaKind === null) {
    issues.push({ field: 'media', key: 'composer.validationMedia' });
  }

  const bound = options.boundAccounts;
  if (bound !== null && countBoundAccounts(bound) === 0) {
    issues.push({ field: 'persona', key: 'composer.validationPersonaAccounts' });
  }
  const accounts = effectiveAccounts(draft, bound);
  const providers = selectedProviders(accounts);

  if (providers.length === 0 && draft.mediaKind !== null) {
    issues.push({ field: 'accounts', key: 'composer.validationAccounts' });
  }
  if (
    draft.mediaKind === 'image' &&
    providers.some((provider) => !isImageProvider(provider))
  ) {
    issues.push({
      field: 'accounts',
      key: 'composer.validationImageProviders',
      vars: { providers: IMAGE_PROVIDERS.join(', ') },
    });
  }

  if (title === '') {
    issues.push({ field: 'title', key: 'composer.validationTitle' });
  } else if (title.length > TITLE_MAX_LENGTH) {
    issues.push({
      field: 'title',
      key: 'composer.validationTitleLong',
      vars: { count: TITLE_MAX_LENGTH },
    });
  }
  if (description === '') {
    issues.push({ field: 'description', key: 'composer.validationDescription' });
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    issues.push({
      field: 'description',
      key: 'composer.validationDescriptionLong',
      vars: { count: DESCRIPTION_MAX_LENGTH },
    });
  }

  if (draft.mode === 'asap' && providers.includes('youtube') && tags.length === 0) {
    issues.push({ field: 'tags', key: 'composer.validationTags' });
  }

  const pinterestCount = accounts.pinterest?.length ?? 0;
  if (pinterestCount > 1) {
    issues.push({ field: 'board', key: 'composer.validationPinterestSingle' });
  }
  const boardId = draft.pinterestBoardId.trim();
  if (pinterestCount > 0 && boardId === '') {
    issues.push({ field: 'board', key: 'composer.validationBoard' });
  }

  let schedule: { publishAt: string; timezone: string } | null = null;
  if (draft.mode === 'scheduled') {
    if (!isValidTimezone(draft.timezone)) {
      issues.push({ field: 'schedule', key: 'composer.validationTimezone' });
    } else {
      const at = parseZonedDateTime(draft.publishAt, draft.timezone);
      if (at === null || !validateScheduleWindow(at, options.now).ok) {
        issues.push({
          field: 'schedule',
          key: 'composer.validationSchedule',
          vars: { min: SCHEDULE_MIN_ADVANCE_HOURS, max: SCHEDULE_MAX_AHEAD_DAYS },
        });
      } else {
        schedule = { publishAt: draft.publishAt.trim(), timezone: draft.timezone };
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    plan: {
      mode: draft.mode,
      providers,
      accounts,
      title,
      description,
      caption: draft.mode === 'asap' && caption !== '' ? caption : null,
      tags: draft.mode === 'asap' && tags.length > 0 ? tags : undefined,
      privacyStatus:
        draft.mode === 'asap' && providers.includes('youtube') ? draft.privacyStatus : undefined,
      firstComment: draft.firstComment.trim() === '' ? null : draft.firstComment.trim(),
      personaId: draft.personaId,
      pinterestBoardId: pinterestCount > 0 ? boardId : null,
      schedule,
    },
  };
}
