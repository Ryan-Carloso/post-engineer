'use client';

import Link from 'next/link';
import {
  useYouTubeAccountsQuery,
  useDeleteScheduleMutation,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  usePersonaListQuery,
  useSchedulesQuery,
  useScheduleStatusQuery,
  useSessionQuery,
  useUpdateScheduleMutation,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';

export default function Home() {
  const personas = usePersonaListQuery();
  const schedules = useSchedulesQuery();
  const youtube = useYouTubeAccountsQuery();
  const instagram = useInstagramAccountsQuery();
  const linkedin = useLinkedinAccountsQuery();

  const shouldShowSkeleton = hasUnavailableHomeData([
    { loading: personas.isPending || personas.isLoading, hasData: personas.data !== undefined },
    { loading: schedules.isPending || schedules.isLoading, hasData: schedules.data !== undefined },
    { loading: youtube.isLoading, hasData: youtube.data !== undefined },
    { loading: instagram.isLoading, hasData: instagram.data !== undefined },
    { loading: linkedin.isLoading, hasData: linkedin.data !== undefined },
  ]);

  if (personas.isError || schedules.isError) {
    return <HomeError />;
  }

  if (shouldShowSkeleton) {
    return <HomeSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6 md:gap-7">
      <HomeHeader />
      <HomeContent />
    </div>
  );
}

//---------------
// hasUnavailableHomeData — mantém o dashboard em skeleton enquanto qualquer
// dependência ainda carrega ou não entregou seus dados iniciais.
//---------------
const hasUnavailableHomeData = (
  states: readonly { loading: boolean; hasData: boolean }[],
): boolean => states.some((state) => state.loading || !state.hasData);

/* -----------------
   Local Components
------------------ */

//---------------
// HomeHeader presents the workspace purpose and primary action.
//---------------
const HomeHeader = () => {
  const { t } = useI18n();
  const session = useSessionQuery();
  const schedules = useSchedulesQuery();
  const metadata = session.data?.user_metadata;
  const name = metadata?.name ?? metadata?.user_name ?? metadata?.provider_id ?? 'Ryan';
  const hasSchedules = (schedules.data?.length ?? 0) > 0;

  if (!hasSchedules) return null;

  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
      <div>
        <p className="text-sm text-[#60758a]">{t('home.greeting', { name })}</p>
        <h1 className="leading-1.08 mt-1 max-w-2xl text-[2rem] font-bold tracking-[-0.045em] text-[#0d2b45] md:text-[2.65rem]">
          {t('home.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#60758a] md:text-base">{t('home.subtitle')}</p>
      </div>
    </header>
  );
};

//---------------
// HomeContent selects the operational or onboarding state.
//---------------
const HomeContent = () => {
  const schedules = useSchedulesQuery();

  if (schedules.isError) return <HomeError />;
  if ((schedules.data?.length ?? 0) === 0) return <HomeEmptyState />;

  return <AutomationGrid />;
};

//---------------
// AutomationGrid renders real schedules as compact operational cards.
//---------------
const AutomationGrid = () => {
  const { t, locale } = useI18n();
  const personas = usePersonaListQuery();
  const schedules = useSchedulesQuery();
  const status = useScheduleStatusQuery();
  const updateSchedule = useUpdateScheduleMutation();
  const deleteSchedule = useDeleteScheduleMutation();
  const youtube = useYouTubeAccountsQuery();
  const instagram = useInstagramAccountsQuery();
  const linkedin = useLinkedinAccountsQuery();
  const dayLabels = locale === 'pt'
    ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <section aria-label={t('home.automations')} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {schedules.data?.map((schedule) => {
        const persona = personas.data?.find((item) => item.id === schedule.personaId);
        const youtubeAccounts = youtube.data?.accounts.filter((item) => schedule.youtubeAccountIds.includes(item.channelId)) ?? [];
        const instagramAccounts = instagram.data?.accounts.filter((item) => schedule.instagramAccountIds.includes(item.igUserId)) ?? [];
        const linkedinAccounts = linkedin.data?.accounts.filter((item) => schedule.linkedinAccountIds.includes(item.providerAccountId)) ?? [];
        const nextSlot = status.data?.upcoming.find((slot) => slot.scheduleId === schedule.id) ?? status.data?.upcoming[0];
        const days = schedule.daysOfWeek.length === 0
          ? t('home.customDays')
          : schedule.daysOfWeek.length === 7
            ? t('home.everyDay')
            : schedule.daysOfWeek.map((day) => dayLabels[day]).join(', ');
        const busy = updateSchedule.isPending || deleteSchedule.isPending;

        return (
          <article key={schedule.id} className="overflow-hidden rounded-xl border border-[#d7e2ea] bg-white shadow-[0_5px_18px_rgba(13,43,69,0.045)]">
            <div className="p-4 md:p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#dce8f0] text-base font-bold text-[#0d2b45]">
                  {persona?.name.charAt(0).toUpperCase() ?? 'P'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-bold text-[#0d2b45]">{persona?.name ?? t('home.unnamedPersona')}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${schedule.active ? 'bg-[#cff5df] text-[#167246]' : 'bg-[#e8edf1] text-[#60758a]'}`}>
                      {schedule.active ? t('home.active') : t('home.paused')}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-[#60758a]">{persona?.niche ?? t('home.personaFallback')}</p>
                </div>
                <button type="button" aria-label={schedule.active ? t('fillSchedule.pause') : t('fillSchedule.resume')} disabled={busy} onClick={() => updateSchedule.mutate({ id: schedule.id, active: !schedule.active })} className="rounded-lg px-2 text-xl leading-none text-[#60758a] hover:bg-[#f4f8fb] disabled:opacity-50">
                  {schedule.active ? '•••' : '▶'}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {youtubeAccounts.map((account) => <span key={account.channelId} className="inline-flex items-center gap-2 rounded-lg bg-[#fff1f0] px-3 py-2 text-xs font-medium text-[#0d2b45]"><span className="text-[#ff2d20]">▶</span>{account.channelName}</span>)}
                {instagramAccounts.map((account) => <span key={account.igUserId} className="inline-flex items-center gap-2 rounded-lg bg-[#fff2f7] px-3 py-2 text-xs font-medium text-[#0d2b45]"><span className="text-[#e1306c]">◎</span>@{account.username}</span>)}
                {linkedinAccounts.map((account) => <span key={account.providerAccountId} className="inline-flex items-center gap-2 rounded-lg bg-[#eef4fb] px-3 py-2 text-xs font-medium text-[#0d2b45]"><span className="text-[#0a66c2]">in</span>{account.accountName ?? account.providerAccountId}</span>)}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#edf2f5] pt-4 text-xs text-[#0d2b45] sm:grid-cols-3">
                <span>▣ {days}</span>
                <span>◷ {schedule.startHour !== null && schedule.endHour !== null
                  ? `${String(schedule.startHour).padStart(2, '0')}:00 - ${String(schedule.endHour).padStart(2, '0')}:00`
                  : t('home.waitingForSchedule')}</span>
                <span>▤ {schedule.postsPerDay} {t('home.postsPerDay')}</span>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-lg bg-[#f1f6fa] px-3 py-2.5">
                <div>
                  <p className="text-[11px] text-[#708397]">{t('home.nextPost')}</p>
                  <p className="text-sm font-semibold text-[#0d2b45]">{nextSlot ? new Date(nextSlot.slotAt).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : t('home.waitingForSchedule')}</p>
                </div>
                <button type="button" aria-label={t('fillSchedule.delete')} onClick={() => { if (window.confirm(t('home.deleteConfirm'))) deleteSchedule.mutate(schedule.id); }} className="rounded-lg px-3 text-xs font-semibold text-[#60758a] hover:bg-white hover:text-red-600">{t('fillSchedule.delete')}</button>
              </div>
            </div>
          </article>
        );
      })}

      <Link href="/personas" className="flex min-h-24 items-center justify-center gap-4 rounded-xl border border-dashed border-[#bfd0dc] bg-white/45 p-5 text-left text-sm text-[#60758a] hover:border-[#7f9aae] hover:bg-white focus-visible:outline-2 lg:col-span-2">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#cbdbe5] text-xl text-[#0d2b45]">+</span>
        <span className="flex min-w-0 flex-col gap-1"><strong className="text-[#0d2b45]">{t('home.createAnother')}</strong><span className="text-sm leading-5 text-neutral-600">{t('home.createAnotherHint')}</span></span>
      </Link>
    </section>
  );
};

//---------------
// HomeEmptyState explains the product and gives one clear first action.
//---------------
const HomeEmptyState = () => {
  const { t } = useI18n();
  return (
    <section className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-4xl flex-col items-center justify-center py-6 text-center md:min-h-[calc(100vh-5rem)]">
      <h1 className="leading-1.05 max-w-xl text-[2.15rem] font-bold tracking-tighter text-[#0d2b45] md:text-5xl">{t('home.emptyTitle')}</h1>
      <p className="mt-4 max-w-lg text-sm leading-6 text-[#60758a] md:text-base">{t('home.emptySubtitle')}</p>
      <div aria-hidden="true" className="relative my-8 h-28 w-60">
        <div className="absolute top-3 left-5 h-20 w-28 -rotate-6 rounded-lg border-[5px] border-white bg-[#d9eafa] shadow-[0_12px_28px_rgba(13,43,69,0.14)]"><div className="m-2 h-9 rounded bg-[#75a7c8]"/><span className="ml-3 text-lg text-red-500">▶</span></div>
        <div className="absolute top-8 right-6 h-20 w-28 rotate-6 rounded-lg border-[5px] border-white bg-[#e8f2f7] shadow-[0_12px_28px_rgba(13,43,69,0.14)]"><div className="m-2 h-9 rounded bg-[#9dc4d8]"/></div>
        <div className="absolute top-1 right-1 flex size-11 rotate-6 items-center justify-center rounded-xl bg-white text-xl text-[#e1306c] shadow-lg">◎</div>
      </div>
      <Link href="/personas" className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-[#0d2b45] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(13,43,69,0.18)] hover:bg-accent-hover"><span className="text-xl font-light">+</span>{t('home.createFirst')}</Link>
      <div className="mt-12 grid w-full gap-7 text-left sm:grid-cols-3 sm:text-center">
        <div><span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[#eee9ff] text-[#7056d9]">✦</span><h2 className="mt-3 text-sm font-bold text-[#0d2b45]">{t('home.benefitGenerate')}</h2><p className="mt-3 text-sm leading-5 text-neutral-600">{t('home.benefitGenerateHint')}</p></div>
        <div><span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[#e1f7ec] text-[#168454]">▣</span><h2 className="mt-3 text-sm font-bold text-[#0d2b45]">{t('home.benefitPublish')}</h2><p className="mt-3 text-sm leading-5 text-neutral-600">{t('home.benefitPublishHint')}</p></div>
        <div><span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[#e7f0ff] text-[#2e6bff]">↗</span><h2 className="mt-3 text-sm font-bold text-[#0d2b45]">{t('home.benefitGrow')}</h2><p className="mt-3 text-sm leading-5 text-neutral-600">{t('home.benefitGrowHint')}</p></div>
      </div>
    </section>
  );
};

//---------------
// HomeError gives a direct recovery action for failed schedule loading.
//---------------
const HomeError = () => {
  const { t } = useI18n();
  const personas = usePersonaListQuery();
  const schedules = useSchedulesQuery();
  const retry = async (): Promise<void> => {
    await Promise.all([personas.refetch(), schedules.refetch()]);
  };

  return <section className="rounded-xl border border-red-200 bg-white p-6 text-center sm:p-8"><h1 className="text-xl font-bold text-[#0d2b45]">{t('home.loadError')}</h1><button type="button" onClick={() => void retry()} className="mt-4 rounded-xl bg-[#0d2b45] px-5 py-2 text-sm font-semibold text-white">{t('accounts.retry')}</button></section>;
};

//---------------
// HomeSkeleton mirrors the final dashboard without reading application state.
//---------------
const HomeSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6 md:gap-7">
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
      <div className="@container w-full max-w-2xl">
        <div className="skeleton-shimmer h-5 w-48 max-w-full rounded-full" />
        <div className="skeleton-shimmer mt-1 h-[4.32rem] w-full rounded-lg md:h-[5.724rem] @min-[28rem]:h-[2.16rem] md:@min-[36rem]:h-[2.862rem]" />
        <div className="skeleton-shimmer mt-2 h-12 w-full rounded-lg @min-[28rem]:h-6" />
      </div>
      <div className="skeleton-shimmer h-13 w-full shrink-0 rounded-xl md:w-48" />
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4 overflow-hidden rounded-xl border border-[#d7e2ea] bg-white p-4 shadow-[0_5px_18px_rgba(13,43,69,0.045)] md:p-5">
        <div className="flex items-start gap-3">
          <div className="skeleton-shimmer size-11 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2"><div className="skeleton-shimmer h-6 w-24 max-w-full rounded" /><div className="skeleton-shimmer h-6 w-14 shrink-0 rounded-full" /></div>
            <div className="flex h-5 items-center"><div className="skeleton-shimmer h-3.5 w-32 max-w-full rounded" /></div>
          </div>
          <div className="flex size-11 shrink-0 items-center justify-center"><div className="skeleton-shimmer h-2 w-6 rounded" /></div>
        </div>
        <div className="flex flex-wrap gap-2"><div className="skeleton-shimmer h-8 w-44 max-w-full rounded-lg" /></div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#edf2f5] pt-4 sm:grid-cols-3"><div className="skeleton-shimmer h-4 rounded" /><div className="skeleton-shimmer h-4 rounded" /><div className="skeleton-shimmer h-4 rounded" /></div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f1f6fa] px-3 py-2.5"><div className="@container flex min-w-0 flex-1 flex-col"><div className="skeleton-shimmer h-4 w-20 max-w-full rounded" /><div className="skeleton-shimmer h-10 w-60 max-w-full rounded @min-[12rem]:h-5" /></div><div className="flex h-11 w-16 shrink-0 items-center"><div className="skeleton-shimmer h-4 w-full rounded" /></div></div>
      </div>
      <div className="@container flex min-h-24 items-center justify-center gap-4 rounded-xl border border-dashed border-[#bfd0dc] bg-white/45 p-5 lg:col-span-2"><div className="skeleton-shimmer size-10 shrink-0 rounded-full" /><div className="flex min-w-0 flex-col gap-1"><div className="skeleton-shimmer h-5 w-40 max-w-full rounded" /><div className="skeleton-shimmer h-10 w-80 max-w-full rounded @min-[27rem]:h-5" /></div></div>
    </div>
  </div>
);
