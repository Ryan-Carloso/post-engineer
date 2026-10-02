'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
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
import { GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
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

const GenerationCard = ({
  generation,
  locale,
}: {
  generation: VideoGeneration;
  locale: 'pt' | 'en';
}) => {
  const { t } = useI18n();
  return (
    <article className="rounded-xl border border-[#d7e2ea] bg-white p-4 shadow-[0_5px_18px_rgba(13,43,69,0.045)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#0d2b45]">
          {formatDateTime(generation.createdAt, locale)}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}`}>
          {t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#0d2b45]">
        <span className="font-semibold">{generation.personaName ?? t('posts.personaFallback')}</span>
        {' — '}
        <span className="text-[#60758a]">{generation.videoSubject ?? t('posts.unknownTopic')}</span>
      </p>
      {generation.status === 'failed' && (
        <p className="mt-2 text-xs text-[#c2301e]">
          {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
        </p>
      )}
      {generation.tokensRefunded && (
        <p className="mt-2">
          <span className="rounded-full bg-[#cff5df] px-2.5 py-1 text-xs font-semibold text-[#167246]">
            {t('posts.refundedBadge')}
          </span>
        </p>
      )}
    </article>
  );
};

// Max rows fetched per tab; the API caps ?limit= at 500, the page asks for
// fewer to keep the render cheap. Exported for tests.
export const POSTS_LIMIT = 200;

function formatDateTime(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
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
  return (
    <article className="rounded-xl border border-[#d7e2ea] bg-white p-4 shadow-[0_5px_18px_rgba(13,43,69,0.045)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#0d2b45]">
          {formatDateTime(isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt, locale)}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[slot.status] ?? STATUS_STYLE.pending}`}>
          {t(STATUS_KEY[slot.status] ?? 'posts.statusPending')}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#0d2b45]">
        <span className="font-semibold">{personaName}</span>
        {' — '}
        <span className="text-[#60758a]">{slot.topic ?? t('posts.unknownTopic')}</span>
      </p>
      {accounts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {accounts.map((account) => (
            <span key={`${account.provider}:${account.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#f1f6fa] px-2.5 py-1.5 text-xs font-medium text-[#0d2b45]">
              <ProviderDot provider={account.provider} />
              {account.label}
            </span>
          ))}
        </div>
      )}
      {slot.status === 'failed' && slot.error && (
        <p className="mt-2 text-xs text-[#c2301e]">{slot.error}</p>
      )}
    </article>
  );
};

const ProviderDot = ({ provider }: { provider: Exclude<ProviderFilter, 'all'> }) => {
  const color = provider === 'youtube' ? 'text-[#ff2d20]' : provider === 'instagram' ? 'text-[#e1306c]' : 'text-[#0a66c2]';
  const glyph = provider === 'youtube' ? '▶' : provider === 'instagram' ? '◎' : 'in';
  return <span className={`font-bold ${color}`}>{glyph}</span>;
};

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
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#0d2b45]">{t('posts.title')}</h1>
          <p className="mt-1 text-sm text-[#60758a]">{t('posts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={statusQuery.isFetching}
            className="rounded-xl border border-[#d7e2ea] bg-white px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb] disabled:opacity-50"
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
              tab === value ? 'bg-white text-[#0d2b45] shadow-sm' : 'text-[#60758a] hover:text-[#0d2b45]'
            }`}
          >
            {t(value === 'upcoming' ? 'posts.tabUpcoming' : 'posts.tabHistory')} ({value === 'upcoming' ? upcomingCount : historyCount})
          </button>
        ))}
      </div>

      {isCapped && !isLoading && !isError && (
        <p className="mt-3 text-xs text-[#60758a]">{t('posts.listCapped', { count: POSTS_LIMIT })}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#60758a]">
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
            className="rounded-xl border border-[#d7e2ea] bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
          >
            <option value="all">{t('posts.allProviders')}</option>
            {PROVIDER_FILTERS.filter((provider) => provider !== 'all').map((provider) => (
              <option key={provider} value={provider}>
                {provider === 'youtube' ? 'YouTube' : provider === 'instagram' ? 'Instagram' : 'LinkedIn'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#60758a]">
          {t('posts.filterAccount')}
          <select
            value={effectiveAccountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            className="rounded-xl border border-[#d7e2ea] bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
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
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#60758a]">
            <SpinnerIcon /> {t('posts.refresh')}…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-[#d7e2ea] bg-white p-8 text-center">
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
                  <p className="mt-3 text-sm text-[#60758a]">{t('posts.generationsEmpty')}</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    {generations.map((generation) => (
                      <GenerationCard key={generation.id} generation={generation} locale={locale} />
                    ))}
                  </div>
                )}
              </section>
            )}
            {filteredSlots.length === 0 ? (
              <div className="rounded-xl border border-[#d7e2ea] bg-white p-8 text-center text-sm text-[#60758a]">
                {hasActiveFilter
                  ? t('posts.noResultsForFilter')
                  : t(tab === 'upcoming' ? 'posts.noUpcoming' : 'posts.noHistory')}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
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
