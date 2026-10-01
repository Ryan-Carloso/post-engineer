'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import {
  useScheduleStatusQuery,
  useSchedulesQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useVideoGenerationsQuery,
  type ScheduledSlot,
  type ScheduleConfig,
  type VideoGeneration,
} from '@/lib/api';
import { Card, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { SpinnerIcon } from '@/lib/ui';

//---------------
// PostsPage — post history + upcoming posts on the same page, across all
// connected accounts. Read-only: consumes GET /api/schedule/status with a
// raised limit and joins each slot with its schedule, persona and the
// publishing accounts. No MCP changes.
//---------------

type Tab = 'upcoming' | 'history';
type ProviderFilter = 'all' | 'youtube' | 'instagram' | 'linkedin';

interface AccountOption {
  id: string;
  provider: Exclude<ProviderFilter, 'all'>;
  label: string;
}

//---------------
// resolveAccountFilter — a selected account only stays applied when it
// belongs to the network filter ('all' keeps any account). Unknown ids
// and incompatible networks fall back to 'all'.
//---------------
function resolveAccountFilter(
  accountId: string,
  provider: ProviderFilter,
  accounts: AccountOption[],
): string {
  if (accountId === 'all') return 'all';
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return 'all';
  if (provider !== 'all' && account.provider !== provider) return 'all';
  return accountId;
}

const PROVIDER_FILTERS: ProviderFilter[] = ['all', 'youtube', 'instagram', 'linkedin'];

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-[#e8edf1] text-[#60758a]',
  generating: 'bg-[#e3f0ff] text-[#1d5bbf]',
  running: 'bg-[#e3f0ff] text-[#1d5bbf]',
  ready: 'bg-[#fff4d6] text-[#9a6b00]',
  publishing: 'bg-[#e3f0ff] text-[#1d5bbf]',
  published: 'bg-[#cff5df] text-[#167246]',
  completed: 'bg-[#cff5df] text-[#167246]',
  failed: 'bg-[#ffe1de] text-[#c2301e]',
};

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  generating: 'posts.statusGenerating',
  ready: 'posts.statusReady',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  failed: 'posts.statusFailed',
};

//---------------
// Generation history cards — standalone video generations (manual/debug),
// not scheduled posts. A failed generation shows the friendly, translated
// error for its error_code; the raw engine text stays in the database for
// support and is never rendered (it may contain paths or upstream bodies).
//---------------
const GENERATION_STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  running: 'posts.statusRunning',
  completed: 'posts.statusCompleted',
  failed: 'posts.statusFailed',
};

const GENERATION_ERROR_KEY: Record<string, TranslationKey> = {
  custom_audio_invalid: 'posts.errorCustomAudio',
  engine_unavailable: 'posts.errorEngineUnavailable',
  engine_rejected: 'posts.errorEngineRejected',
  no_task_id: 'posts.errorNoTaskId',
  invalid_task_response: 'posts.errorInvalidTaskResponse',
  unknown: 'posts.errorUnknown',
};

const GenerationCard = ({
  generation,
  locale,
}: {
  generation: VideoGeneration;
  locale: 'pt' | 'en';
}) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const hasThumb = generation.status === 'completed' && videoUrl !== null;
  return (
    <Link href={`/posts/${generation.id}`} className="block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          <span role="img" aria-label="video" className="inline-flex text-muted-foreground">
            <Play className="size-5" />
          </span>
          <p className="text-xs text-muted-foreground">
            {formatDate(generation.createdAt, locale)} · {formatTime(generation.createdAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <p className="line-clamp-3 text-sm leading-snug text-[#0d2b45]">
              <span className="font-semibold">{generation.personaName ?? t('posts.personaFallback')}</span>
              {' — '}
              <span className="text-muted-foreground">{generation.videoSubject ?? t('posts.unknownTopic')}</span>
            </p>
            {generation.status === 'failed' && (
              <p className="mt-2 line-clamp-2 text-xs text-destructive">
                {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
              </p>
            )}
          </div>
          <PostThumb src={hasThumb ? videoUrl : null} />
        </div>
        <CardFooter className="mt-auto items-center justify-between p-0 pt-4">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{generation.videoSubject ?? t('posts.unknownTopic')}</span>
          <div className="flex shrink-0 items-center gap-2">
            {generation.tokensRefunded && (
              <Badge variant="outline" className="border-transparent bg-[#cff5df] text-[#167246]">
                {t('posts.refundedBadge')}
              </Badge>
            )}
            <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}`}>
              {t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
            </Badge>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
};

// Max rows fetched per tab; the API caps ?limit= at 500, the page asks for
// fewer to keep the render cheap. Exported for tests.
export const POSTS_LIMIT = 200;

function formatDate(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
  });
}

function formatTime(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleTimeString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    timeStyle: 'short',
  });
}

//---------------
// resolveSlotAccounts — human-readable account labels for one slot, based
// on the schedule's targeted account ids per provider.
//---------------
function resolveSlotAccounts(
  schedule: ScheduleConfig | undefined,
  accounts: AccountOption[],
): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set([
    ...schedule.youtubeAccountIds,
    ...schedule.instagramAccountIds,
    ...schedule.linkedinAccountIds,
  ]);
  return accounts.filter((account) => ids.has(account.id));
}

const PostCard = ({
  slot,
  personaName,
  accounts,
  locale,
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: 'pt' | 'en';
}) => {
  const { t } = useI18n();
  const isHistory = slot.status === 'published' || slot.status === 'failed';
  const shownAt = isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const videoUrl = videoUrlFor(slot.taskId);
  const hasThumb = SLOT_VIDEO_STATUSES.has(slot.status) && videoUrl !== null;
  const provider = accounts[0]?.provider;
  return (
    <Link href={`/posts/${slot.id}`} className="block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          {provider ? <ProviderIcon provider={provider} /> : <span />}
          <p className="text-xs text-muted-foreground">
            {formatDate(shownAt, locale)} · {formatTime(shownAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <p className="line-clamp-3 flex-1 text-sm leading-snug text-[#0d2b45]">
            <span className="font-semibold">{personaName}</span>
            {' — '}
            <span className="text-muted-foreground">{slot.topic ?? t('posts.unknownTopic')}</span>
          </p>
          <PostThumb src={hasThumb ? videoUrl : null} />
        </div>
        <CardFooter className="mt-auto items-center justify-between p-0 pt-4">
          <AccountAvatarGroup accounts={accounts} />
          <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[slot.status] ?? STATUS_STYLE.pending}`}>
            {t(STATUS_KEY[slot.status] ?? 'posts.statusPending')}
          </Badge>
        </CardFooter>
      </Card>
      {slot.status === 'failed' && slot.error && (
        <p className="sr-only">{slot.error}</p>
      )}
    </Link>
  );
};

//---------------
// accountInitials — compact circular avatars use the account label's
// initials (first letters of up to two tokens, unicode-aware so non-Latin
// accounts get real initials too).
//---------------
function accountInitials(label: string): string {
  const tokens = label.replace(/^@/, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? '').join('');
}

const AccountAvatarGroup = ({ accounts }: { accounts: AccountOption[] }) => (
  <div className="flex -space-x-1.5">
    {accounts.slice(0, 4).map((account) => (
      <Avatar key={`${account.provider}:${account.id}`} className="size-6 ring-2 ring-white">
        <AvatarFallback className="bg-secondary text-[9px] font-semibold text-[#0d2b45]">
          {accountInitials(account.label)}
        </AvatarFallback>
      </Avatar>
    ))}
  </div>
);

//---------------
// PostThumb — the 72×72 thumbnail on the card body's right: the video
// itself (metadata-only preload, muted, control-less — playback happens
// in the detail modal) under a small play glyph. The src carries a
// #t=0.1 media fragment so the browser seeks and paints that frame as
// the thumbnail — preload="metadata" alone renders an empty box in
// Chrome even when the video exists.
//---------------
const PostThumb = ({ src }: { src: string | null }) => {
  const thumbSrc = src ? `${src}#t=0.1` : null;
  return (
    <div className="relative w-18 shrink-0">
      <AspectRatio ratio={1} className="w-18 rounded-[9px] bg-[#e8edf1]">
        {thumbSrc ? (
          <video src={thumbSrc} preload="metadata" muted playsInline className="size-full object-cover" />
        ) : null}
      </AspectRatio>
      {thumbSrc && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Play className="size-4 fill-white text-white drop-shadow" />
        </span>
      )}
    </div>
  );
};

const CARD_BORDER = 'border-[#e3ebf1] shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-[#c8d6e0]';

//---------------
// videoUrlFor — the engine download proxy serves the final render for a
// task; only slots whose video was actually produced have one.
//---------------
function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);

//---------------
export default function PostsPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const statusQuery = useScheduleStatusQuery(POSTS_LIMIT);
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const generationsQuery = useVideoGenerationsQuery(POSTS_LIMIT);
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();

  const scheduleById = useMemo(
    () => new Map((schedulesQuery.data ?? []).map((schedule) => [schedule.id, schedule])),
    [schedulesQuery.data],
  );
  const personaNameById = useMemo(
    () => new Map((personasQuery.data ?? []).map((persona) => [persona.id, persona.name])),
    [personasQuery.data],
  );

  const accountOptions: AccountOption[] = useMemo(
    () => [
      ...(youtubeQuery.data?.accounts ?? []).map((account) => ({
        id: account.channelId,
        provider: 'youtube' as const,
        label: account.channelName,
      })),
      ...(instagramQuery.data?.accounts ?? []).map((account) => ({
        id: account.igUserId,
        provider: 'instagram' as const,
        label: `@${account.username}`,
      })),
      ...(linkedinQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        provider: 'linkedin' as const,
        label: account.accountName ?? account.providerAccountId,
      })),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data],
  );

  const visibleAccounts = useMemo(
    () => (providerFilter === 'all' ? accountOptions : accountOptions.filter((account) => account.provider === providerFilter)),
    [accountOptions, providerFilter],
  );

  // Switching the network resets the account filter when the account no
  // longer belongs to the selected network.
  const effectiveAccountFilter = useMemo(
    () => resolveAccountFilter(accountFilter, providerFilter, accountOptions),
    [accountFilter, accountOptions, providerFilter],
  );

  // Slots whose schedule was deleted are dropped everywhere — the tab
  // counts and the rendered list must agree, so both derive from these.
  const joinedUpcoming = useMemo(
    () => (statusQuery.data?.upcoming ?? []).filter((slot) => scheduleById.has(slot.scheduleId)),
    [statusQuery.data, scheduleById],
  );
  const joinedRecent = useMemo(
    () => (statusQuery.data?.recent ?? []).filter((slot) => scheduleById.has(slot.scheduleId)),
    [statusQuery.data, scheduleById],
  );

  const filteredSlots = useMemo(() => {
    const slots = tab === 'upcoming' ? joinedUpcoming : joinedRecent;
    return slots.filter((slot) => {
      const schedule = scheduleById.get(slot.scheduleId);
      if (!schedule) return false;
      if (providerFilter !== 'all' && !schedule.providers.includes(providerFilter)) return false;
      if (effectiveAccountFilter !== 'all') {
        const ids = new Set([
          ...schedule.youtubeAccountIds,
          ...schedule.instagramAccountIds,
          ...schedule.linkedinAccountIds,
        ]);
        if (!ids.has(effectiveAccountFilter)) return false;
      }
      return true;
    });
  }, [tab, joinedUpcoming, joinedRecent, scheduleById, providerFilter, effectiveAccountFilter]);

  const isLoading = statusQuery.isLoading || schedulesQuery.isLoading || personasQuery.isLoading || generationsQuery.isLoading;
  const isError = statusQuery.isError || schedulesQuery.isError || personasQuery.isError || generationsQuery.isError;
  const hasActiveFilter = providerFilter !== 'all' || effectiveAccountFilter !== 'all';
  const upcomingCount = joinedUpcoming.length;
  const generations = generationsQuery.data ?? [];
  const historyCount = joinedRecent.length + generations.length;
  // The error state covers all four queries, so retry must refetch all of
  // them — a failed schedules, personas or generations query would otherwise
  // never clear without a full page reload.
  const handleRetry = useCallback(() => {
    void statusQuery.refetch();
    void schedulesQuery.refetch();
    void personasQuery.refetch();
    void generationsQuery.refetch();
  }, [statusQuery, schedulesQuery, personasQuery, generationsQuery]);
  // The fetch truncates at POSTS_LIMIT rows; say so instead of implying the
  // list is complete.
  const activeSlots = tab === 'upcoming' ? joinedUpcoming : joinedRecent;
  const isCapped = activeSlots.length >= POSTS_LIMIT;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#0d2b45]">{t('posts.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('posts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={statusQuery.isFetching}
            className="rounded-xl border border-input bg-white px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb] disabled:opacity-50"
          >
            {t('posts.refresh')}
          </button>
          <Link href="/schedule" className="rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]">
            {t('posts.newSchedule')}
          </Link>
        </div>
      </div>

      <div className="mt-6 flex gap-1 rounded-xl bg-[#edf2f5] p-1">
        {(['upcoming', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === value ? 'bg-white text-[#0d2b45] shadow-sm' : 'text-muted-foreground hover:text-[#0d2b45]'
            }`}
          >
            {t(value === 'upcoming' ? 'posts.tabUpcoming' : 'posts.tabHistory')} ({value === 'upcoming' ? upcomingCount : historyCount})
          </button>
        ))}
      </div>

      {isCapped && !isLoading && !isError && (
        <p className="mt-3 text-xs text-muted-foreground">{t('posts.listCapped', { count: POSTS_LIMIT })}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('posts.filterProvider')}
          <select
            value={providerFilter}
            onChange={(event) => {
              const next = event.target.value as ProviderFilter;
              setProviderFilter(next);
              // A selected account that doesn't belong to the new network
              // would otherwise linger in state and silently reactivate when
              // switching back — reset it instead.
              setAccountFilter((current) => resolveAccountFilter(current, next, accountOptions));
            }}
            className="rounded-xl border border-input bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
          >
            <option value="all">{t('posts.allProviders')}</option>
            {PROVIDER_FILTERS.filter((provider) => provider !== 'all').map((provider) => (
              <option key={provider} value={provider}>
                {provider === 'youtube' ? 'YouTube' : provider === 'instagram' ? 'Instagram' : 'LinkedIn'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('posts.filterAccount')}
          <select
            value={effectiveAccountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            className="rounded-xl border border-input bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
          >
            <option value="all">{t('posts.allAccounts')}</option>
            {visibleAccounts.map((account) => (
              <option key={`${account.provider}:${account.id}`} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <SpinnerIcon /> {t('posts.refresh')}…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-input bg-white p-8 text-center">
            <p className="text-sm font-semibold text-[#0d2b45]">{t('posts.loadError')}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]"
            >
              {t('posts.refresh')}
            </button>
          </div>
        ) : (
          <>
            {tab === 'history' && (
              <section aria-label={t('posts.generationsTitle')} className="mb-8">
                <h2 className="text-base font-bold tracking-[-0.01em] text-[#0d2b45]">
                  {t('posts.generationsTitle')}
                </h2>
                {generations.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">{t('posts.generationsEmpty')}</p>
                ) : (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {generations.map((generation) => (
                      <GenerationCard
                        key={generation.id}
                        generation={generation}
                        locale={locale}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
            {filteredSlots.length === 0 ? (
              <div className="rounded-xl border border-input bg-white p-8 text-center text-sm text-muted-foreground">
                {hasActiveFilter
                  ? t('posts.noResultsForFilter')
                  : t(tab === 'upcoming' ? 'posts.noUpcoming' : 'posts.noHistory')}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredSlots.map((slot) => (
                  <PostCard
                    key={slot.id}
                    slot={slot}
                    personaName={personaNameById.get(scheduleById.get(slot.scheduleId)?.personaId ?? '') ?? t('posts.personaFallback')}
                    accounts={resolveSlotAccounts(scheduleById.get(slot.scheduleId), accountOptions)}
                    locale={locale}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
