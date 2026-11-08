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
  useThreadsAccountsQuery,
  useBlueskyAccountsQuery,
  useVideoGenerationsQuery,
  type ScheduledSlot,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { SpinnerIcon } from '@/lib/ui';
import { PROVIDER_LABELS, accountOption, type AccountOption, scheduleAccountIds } from '@/lib/account-options';
import { RANGE_MAX_SLOTS, useScheduleRangeQuery } from '@/lib/schedule-range';
import { PostCard, GenerationCard, resolveSlotAccounts } from './post-card';
import { CalendarView } from './calendar-view';
import { GROUP_KEY, GROUP_STYLE, STATUS_GROUP_ORDER } from './status';
import {
  FIRST_WEEKDAY,
  INTL_TAG,
  bucketByDay,
  buildMonthGrid,
  dateFromKey,
  dayKey,
  groupCounts,
  gridRange,
  monthKey,
} from './calendar-days';

//---------------
// PostsPage — post history + upcoming posts on the same page, across all
// connected accounts. Read-only: consumes GET /api/schedule/status with a
// raised limit (list view) or a from/to range (calendar view) and joins each
// slot with its schedule, persona and the publishing accounts.
//---------------

type Tab = 'upcoming' | 'history';
type View = 'list' | 'calendar';
type ProviderFilter = 'all' | 'youtube' | 'instagram' | 'linkedin' | 'bluesky' | 'threads';

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

const PROVIDER_FILTERS: ProviderFilter[] = ['all', 'youtube', 'instagram', 'linkedin', 'bluesky', 'threads'];

// Max rows fetched per tab; the API caps ?limit= at 500, the page asks for
// fewer to keep the render cheap. Exported for tests.
export const POSTS_LIMIT = 200;

export default function PostsPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<View>('list');
  // Calendar state. "Today" is the viewer's local day (see calendar-days.ts).
  const [todayKey] = useState(() => dayKey(new Date()));
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(todayKey);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const statusQuery = useScheduleStatusQuery(POSTS_LIMIT);
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const generationsQuery = useVideoGenerationsQuery(POSTS_LIMIT);
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();
  const blueskyQuery = useBlueskyAccountsQuery();
  const threadsQuery = useThreadsAccountsQuery();

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
      ...(youtubeQuery.data?.accounts ?? []).map(accountOption),
      ...(instagramQuery.data?.accounts ?? []).map(accountOption),
      ...(linkedinQuery.data?.accounts ?? []).map(accountOption),
      ...(blueskyQuery.data?.accounts ?? []).map(accountOption),
      ...(threadsQuery.data?.accounts ?? []).map(accountOption),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data, blueskyQuery.data, threadsQuery.data],
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

  const passesFilters = useCallback(
    (slot: ScheduledSlot): boolean => {
      const schedule = scheduleById.get(slot.scheduleId);
      if (!schedule) return false;
      if (providerFilter !== 'all' && !schedule.providers.includes(providerFilter)) return false;
      if (effectiveAccountFilter !== 'all') {
        const ids = new Set(scheduleAccountIds(schedule));
        if (!ids.has(effectiveAccountFilter)) return false;
      }
      return true;
    },
    [scheduleById, providerFilter, effectiveAccountFilter],
  );

  const filteredSlots = useMemo(
    () => (tab === 'upcoming' ? joinedUpcoming : joinedRecent).filter(passesFilters),
    [tab, joinedUpcoming, joinedRecent, passesFilters],
  );

  // Calendar: the visible 6-week grid is one range read (never the list
  // view's POSTS_LIMIT), filtered like the list and bucketed by local day.
  const firstWeekday = FIRST_WEEKDAY[locale];
  const gridDays = useMemo(() => buildMonthGrid(cursor.year, cursor.month, firstWeekday), [cursor, firstWeekday]);
  const range = useMemo(() => gridRange(gridDays), [gridDays]);
  const rangeQuery = useScheduleRangeQuery(monthKey(cursor.year, cursor.month), range.from, range.to, view === 'calendar');
  const calendarSlots = useMemo(
    () => (rangeQuery.data?.slots ?? []).filter(passesFilters),
    [rangeQuery.data, passesFilters],
  );
  const slotsByDay = useMemo(() => bucketByDay(calendarSlots), [calendarSlots]);
  const selectedSlots = useMemo(
    () => (selectedKey === null ? [] : [...(slotsByDay.get(selectedKey) ?? [])].sort((a, b) => a.slotAt.localeCompare(b.slotAt))),
    [slotsByDay, selectedKey],
  );

  const isCalendar = view === 'calendar';
  const isLoading = isCalendar
    ? rangeQuery.isLoading || schedulesQuery.isLoading || personasQuery.isLoading
    : statusQuery.isLoading || schedulesQuery.isLoading || personasQuery.isLoading || generationsQuery.isLoading;
  const isError = isCalendar
    ? rangeQuery.isError || schedulesQuery.isError || personasQuery.isError
    : statusQuery.isError || schedulesQuery.isError || personasQuery.isError || generationsQuery.isError;
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
    if (view === 'calendar') void rangeQuery.refetch();
  }, [statusQuery, schedulesQuery, personasQuery, generationsQuery, rangeQuery, view]);
  // The fetch truncates at POSTS_LIMIT rows; say so instead of implying the
  // list is complete.
  const activeSlots = tab === 'upcoming' ? joinedUpcoming : joinedRecent;
  const isCapped = !isCalendar && activeSlots.length >= POSTS_LIMIT;

  const renderSlotCard = (slot: ScheduledSlot) => {
    // A post created without a persona (migration 012) has none to look up —
    // that is not a removed persona, and saying so would be a lie about a post
    // that never had one.
    const personaId = scheduleById.get(slot.scheduleId)?.personaId ?? null;
    const personaName =
      personaId === null ? t('posts.noPersona') : personaNameById.get(personaId) ?? t('posts.personaFallback');
    return (
      <PostCard
        key={slot.id}
        slot={slot}
        personaName={personaName}
        accounts={resolveSlotAccounts(scheduleById.get(slot.scheduleId), accountOptions)}
        locale={locale}
      />
    );
  };

  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' });
  const monthName = new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-primary">{t('posts.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('posts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={statusQuery.isFetching}
            className="rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50"
          >
            {t('posts.refresh')}
          </button>
          {/* The mobile bottom bar has no Metrics tab (pinned at four tabs in layout.test.tsx); this button is how phones reach /metrics. */}
          <Link href="/metrics" className="rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-background">
            {t('nav.metrics')}
          </Link>
        </div>
      </div>

      <div role="group" aria-label={t('posts.viewToggleLabel')} className="mt-6 flex gap-1 rounded-xl bg-sunken p-1 sm:w-fit">
        {(['list', 'calendar'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            aria-pressed={view === value}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              view === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-primary'
            }`}
          >
            {t(value === 'list' ? 'posts.viewList' : 'posts.viewCalendar')}
          </button>
        ))}
      </div>

      {!isCalendar && (
        <div className="mt-3 flex gap-1 rounded-xl bg-sunken p-1">
          {(['upcoming', 'history'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              {t(value === 'upcoming' ? 'posts.tabUpcoming' : 'posts.tabHistory')} ({value === 'upcoming' ? upcomingCount : historyCount})
            </button>
          ))}
        </div>
      )}

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
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm font-medium text-primary"
          >
            <option value="all">{t('posts.allProviders')}</option>
            {PROVIDER_FILTERS.filter(
              (provider): provider is Exclude<ProviderFilter, 'all'> => provider !== 'all',
            ).map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('posts.filterAccount')}
          <select
            value={effectiveAccountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm font-medium text-primary"
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
          <div className="rounded-xl border border-input bg-card p-8 text-center">
            <p className="text-sm font-semibold text-primary">{t('posts.loadError')}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-ink hover:bg-accent-hover"
            >
              {t('posts.refresh')}
            </button>
          </div>
        ) : isCalendar ? (
          <>
            {rangeQuery.data?.truncated === true && (
              <p className="mb-3 text-xs text-muted-foreground">{t('posts.calendarTruncated', { count: RANGE_MAX_SLOTS })}</p>
            )}
            <CalendarView
              year={cursor.year}
              month={cursor.month}
              locale={locale}
              firstWeekday={firstWeekday}
              slotsByDay={slotsByDay}
              selectedKey={selectedKey}
              focusKey={focusKey}
              todayKey={todayKey}
              labels={{
                grid: t('posts.calendarGridLabel', { month: monthName }),
                prev: t('posts.calendarPrevMonth'),
                next: t('posts.calendarNextMonth'),
                today: t('posts.calendarToday'),
                groups: {
                  inProgress: t(GROUP_KEY.inProgress),
                  published: t(GROUP_KEY.published),
                  failed: t(GROUP_KEY.failed),
                },
                dayLabel: (date, summary) => t('posts.calendarDayLabel', { date, summary }),
                dayEmpty: (date) => t('posts.calendarDayEmpty', { date }),
                more: (count) => t('posts.calendarMore', { count }),
              }}
              onSelect={setSelectedKey}
              onFocusChange={setFocusKey}
              onMonthChange={(year, month) => setCursor({ year, month })}
            />
            <section aria-live="polite" className="mt-6">
              {selectedKey === null ? (
                <p className="text-sm text-muted-foreground">{t('posts.calendarNoDay')}</p>
              ) : (
                <>
                  <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
                    {t('posts.calendarDayHeading', { date: dayFormat.format(dateFromKey(selectedKey)) })}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {STATUS_GROUP_ORDER.map((group) => (
                      <li key={group} className={`rounded-full px-2 py-0.5 font-semibold ${GROUP_STYLE[group]}`}>
                        {t(GROUP_KEY[group])}: {groupCounts(selectedSlots)[group]}
                      </li>
                    ))}
                  </ul>
                  {selectedSlots.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t('posts.calendarDayNone')}</p>
                  ) : (
                    <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{selectedSlots.map(renderSlotCard)}</div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <>
            {tab === 'history' && (
              <section aria-label={t('posts.generationsTitle')} className="mb-8">
                <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
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
              <div className="rounded-xl border border-input bg-card p-8 text-center text-sm text-muted-foreground">
                {hasActiveFilter
                  ? t('posts.noResultsForFilter')
                  : t(tab === 'upcoming' ? 'posts.noUpcoming' : 'posts.noHistory')}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredSlots.map(renderSlotCard)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
