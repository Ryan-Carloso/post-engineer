'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePersonaListQuery,
  useSchedulesQuery,
  createSchedule,
  ScheduleError,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { CheckIcon, SpinnerIcon } from '@/lib/ui';
import BatchForm from './batch-form';

//---------------
// SchedulePage — scheduling for an EXISTING persona.
// Separate flow from persona creation: here you only pick who posts
// (persona), where (accounts) and when (weekly autopilot or single video).
// Backend: POST /api/schedule (1 schedule per persona -> 409).
//---------------

const DAY_KEYS: readonly TranslationKey[] = [
  'fillSchedule.day0', 'fillSchedule.day1', 'fillSchedule.day2',
  'fillSchedule.day3', 'fillSchedule.day4', 'fillSchedule.day5', 'fillSchedule.day6',
];

export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <ScheduleContent />
    </Suspense>
  );
}

const ScheduleContent = () => {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const personasQuery = usePersonaListQuery();
  const schedulesQuery = useSchedulesQuery();
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();

  const [personaId, setPersonaId] = useState('');
  const [youtubeSelected, setYoutubeSelected] = useState<string[]>([]);
  const [instagramSelected, setInstagramSelected] = useState<string[]>([]);
  const [linkedinSelected, setLinkedinSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'recurring' | 'one-off'>('recurring');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [times, setTimes] = useState<string[]>(['09:00']);
  const [oneOffDate, setOneOffDate] = useState('');
  const [oneOffTime, setOneOffTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-selection via /schedule?personaId=
  useEffect(() => {
    const fromQuery = searchParams.get('personaId');
    if (fromQuery) setPersonaId(fromQuery);
  }, [searchParams]);

  const personas = personasQuery.data ?? [];
  const scheduledPersonaIds = useMemo(
    () => new Set((schedulesQuery.data ?? []).map((schedule) => schedule.personaId)),
    [schedulesQuery.data],
  );
  const availablePersonas = personas.filter((persona) => !scheduledPersonaIds.has(persona.id));
  const selectedIsScheduled = personaId !== '' && scheduledPersonaIds.has(personaId);

  const youtubeAccounts = youtubeQuery.data?.accounts ?? [];
  const instagramAccounts = instagramQuery.data?.accounts ?? [];
  const linkedinAccounts = linkedinQuery.data?.accounts ?? [];
  const hasAccounts = youtubeAccounts.length > 0 || instagramAccounts.length > 0 || linkedinAccounts.length > 0;

  const toggleDay = (day: number) => {
    setDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b),
    );
  };

  const setTime = (index: number, value: string) => {
    setTimes((current) => current.map((time, i) => (i === index ? value : time)));
  };

  const addTime = () => setTimes((current) => [...current, '12:00']);
  const removeTime = (time: string) =>
    setTimes((current) => (current.length === 1 ? current : current.filter((item) => item !== time)));

  const randomizeTimes = () =>
    setTimes((current) =>
      current.map(() => {
        const hour = 8 + Math.floor(Math.random() * 12);
        const minute = Math.floor(Math.random() * 4) * 15;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }),
    );

  const buildWindow = (values: string[]): { startHour: number; endHour: number } => {
    const hours = values.map((time) => Number.parseInt(time.slice(0, 2), 10));
    return { startHour: Math.min(...hours), endHour: Math.max(...hours) };
  };

  const handleSubmit = async () => {
    setError(null);
    setConflict(false);

    if (!personaId) {
      setError(t('fillSchedule.needPersona'));
      return;
    }
    if (youtubeSelected.length === 0 && instagramSelected.length === 0 && linkedinSelected.length === 0) {
      setError(t('fillSchedule.mustSelectAccount'));
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const youtubeAccountIds = youtubeAccounts
      .filter((account) => youtubeSelected.includes(account.channelId))
      .map((account) => account.channelId);
    const instagramAccountIds = instagramAccounts
      .filter((account) => instagramSelected.includes(account.igUserId))
      .map((account) => account.igUserId);
    const linkedinAccountIds = linkedinAccounts
      .filter((account) => linkedinSelected.includes(account.providerAccountId))
      .map((account) => account.providerAccountId);
    const providers = [
      youtubeAccountIds.length > 0 ? 'youtube' : null,
      instagramAccountIds.length > 0 ? 'instagram' : null,
      linkedinAccountIds.length > 0 ? 'linkedin' : null,
    ].filter((provider): provider is string => provider !== null);

    let payload: Parameters<typeof createSchedule>[0];
    if (mode === 'one-off') {
      if (!oneOffDate || !oneOffTime) {
        setError(t('fillSchedule.oneOffRequired'));
        return;
      }
      // Built in the browser: Date resolves in the DEVICE timezone and the
      // ISO carries the offset — the backend validates/parses the right instant.
      const scheduledAt = new Date(`${oneOffDate}T${oneOffTime}`);
      payload = {
        personaId,
        providers,
        youtubeAccountIds,
        instagramAccountIds,
        linkedinAccountIds,
        daysOfWeek: [],
        postsPerDay: 1,
        timezone,
        scheduledAt: scheduledAt.toISOString(),
      };
    } else {
      if (days.length === 0) {
        setError(t('fillSchedule.daysHint'));
        return;
      }
      // Clears emptied times (<input type=time> empty) before windowing.
      const effectiveTimes = times.filter((time) => /^\d{2}:\d{2}$/.test(time));
      if (effectiveTimes.length === 0) {
        setError(t('fillSchedule.scheduleTimes'));
        return;
      }
      const window = buildWindow(effectiveTimes);
      payload = {
        personaId,
        providers,
        youtubeAccountIds,
        instagramAccountIds,
        linkedinAccountIds,
        daysOfWeek: days,
        startHour: window.startHour,
        endHour: window.endHour,
        postsPerDay: effectiveTimes.length,
        times: effectiveTimes,
        timezone,
      };
    }

    setSubmitting(true);
    try {
      await createSchedule(payload);
      await queryClient.invalidateQueries({ queryKey: ['fill-schedules'] });
      router.push('/');
    } catch (submitError: unknown) {
      if (submitError instanceof ScheduleError && submitError.status === 409) {
        setConflict(true);
      } else if (submitError instanceof ScheduleError && submitError.status >= 400 && submitError.status < 500) {
        // 400s carry the real backend message (e.g.: 24h-30d window).
        setError(submitError.message);
      } else {
        setError(t('pricing.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (personasQuery.isLoading || schedulesQuery.isLoading) {
    return <ScheduleSkeleton />;
  }

  if (personas.length === 0) {
    return (
      <ScheduleShell>
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-neutral-600">{t('fillSchedule.noPersonasFound')}</p>
          <Link
            href="/persona"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t('fillSchedule.createPersona')}
          </Link>
        </div>
      </ScheduleShell>
    );
  }

  if (availablePersonas.length === 0) {
    return (
      <ScheduleShell>
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-neutral-600">{t('fillSchedule.allScheduled')}</p>
          <Link
            href="/persona"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t('fillSchedule.createPersona')}
          </Link>
        </div>
      </ScheduleShell>
    );
  }

  return (
    <ScheduleShell>
      <div className="space-y-5">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <SectionHeading title={t('fillSchedule.personaLabel')} hint={t('fillSchedule.personaHelper')} />
          <select
            aria-label={t('fillSchedule.personaLabel')}
            value={personaId}
            onChange={(event) => {
              setPersonaId(event.target.value);
              setConflict(false);
            }}
            className="mt-4 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 outline-none focus:border-blue-400"
          >
            <option value="">{t('fillSchedule.scheduledFor')}…</option>
            {availablePersonas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
          {(selectedIsScheduled || conflict) && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-800">
              <span>{t('fillSchedule.alreadyScheduled')}</span>
            </div>
          )}
        </section>

        {hasAccounts && (
          <>
            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <SectionHeading title={t('fillSchedule.destinationsLabel')} hint={t('fillSchedule.destinationsHelper')} />
                <button
                  type="button"
                  onClick={() => {
                    setYoutubeSelected(youtubeAccounts.map((account) => account.channelId));
                    setInstagramSelected(instagramAccounts.map((account) => account.igUserId));
                    setLinkedinSelected(linkedinAccounts.map((account) => account.providerAccountId));
                  }}
                  className="shrink-0 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  {t('fillSchedule.selectAll')}
                </button>
              </div>
              <fieldset>
                <div className="mt-5 flex flex-wrap gap-3">
                  {youtubeAccounts.map((account) => (
                    <AccountCard
                      key={account.channelId}
                      name={account.channelName}
                      subtitle="YouTube"
                      thumbnail={account.thumbnail}
                      selected={youtubeSelected.includes(account.channelId)}
                      onSelect={() =>
                        setYoutubeSelected((current) =>
                          current.includes(account.channelId)
                            ? current.filter((id) => id !== account.channelId)
                            : [...current, account.channelId],
                        )
                      }
                    />
                  ))}
                  {instagramAccounts.map((account) => (
                    <AccountCard
                      key={account.igUserId}
                      name={account.username}
                      subtitle="Instagram"
                      thumbnail={account.profilePictureUrl}
                      selected={instagramSelected.includes(account.igUserId)}
                      onSelect={() =>
                        setInstagramSelected((current) =>
                          current.includes(account.igUserId)
                            ? current.filter((id) => id !== account.igUserId)
                            : [...current, account.igUserId],
                        )
                      }
                    />
                  ))}
                  {linkedinAccounts.map((account) => (
                    <AccountCard
                      key={account.providerAccountId}
                      name={account.accountName ?? account.providerAccountId}
                      subtitle={account.accountMetadata?.kind === 'organization' ? 'LinkedIn Page' : 'LinkedIn'}
                      selected={linkedinSelected.includes(account.providerAccountId)}
                      onSelect={() =>
                        setLinkedinSelected((current) =>
                          current.includes(account.providerAccountId)
                            ? current.filter((id) => id !== account.providerAccountId)
                            : [...current, account.providerAccountId],
                        )
                      }
                    />
                  ))}
                  <Link
                    href="/accounts"
                    className="flex min-h-21 w-full max-w-85 items-center gap-3 rounded-xl border border-dashed border-neutral-300 px-3 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40 sm:w-55"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl text-blue-600">+</span>
                    <span className="min-w-0 flex-1"><strong className="block text-sm text-neutral-800">{t('fillSchedule.addAccount')}</strong></span>
                  </Link>
                </div>
              </fieldset>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeading title={t('fillSchedule.activate')} hint={t('fillSchedule.subtitle')} />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${mode === 'recurring' ? 'border-blue-500 bg-blue-50/40' : 'border-neutral-200 hover:border-blue-300'}`}>
                  <input
                    type="radio"
                    name="schedule-mode"
                    aria-label={t('fillSchedule.modeRecurring')}
                    checked={mode === 'recurring'}
                    onChange={() => setMode('recurring')}
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-sm text-neutral-900">{t('fillSchedule.modeRecurring')}</strong>
                    <span className="mt-1 block text-xs text-neutral-500">{t('fillSchedule.modeRecurringHint')}</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${mode === 'one-off' ? 'border-blue-500 bg-blue-50/40' : 'border-neutral-200 hover:border-blue-300'}`}>
                  <input
                    type="radio"
                    name="schedule-mode"
                    aria-label={t('fillSchedule.oneOff')}
                    checked={mode === 'one-off'}
                    onChange={() => setMode('one-off')}
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-sm text-neutral-900">{t('fillSchedule.oneOff')}</strong>
                    <span className="mt-1 block text-xs text-neutral-500">{t('fillSchedule.oneOffHint')}</span>
                  </span>
                </label>
              </div>

              {mode === 'recurring' ? (
                <>
                  <div className="mt-6 flex items-start justify-between gap-4">
                    <SectionHeading title={t('fillSchedule.daysLabel')} hint={t('fillSchedule.daysHint')} />
                    <span className="shrink-0 rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600">
                      {t('fillSchedule.daysSelected', { count: days.length })}
                    </span>
                  </div>
                  <fieldset>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {DAY_KEYS.map((dayKey, day) => {
                        const selected = days.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleDay(day)}
                            className={`min-w-12 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-blue-300'
                            }`}
                          >
                            {t(dayKey)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="mt-6 flex items-start justify-between gap-4">
                    <SectionHeading title={t('fillSchedule.scheduleTimes')} hint={t('fillSchedule.scheduleTimesHint')} />
                    <button
                      type="button"
                      onClick={randomizeTimes}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-600"
                    >
                      {t('fillSchedule.randomTimes')}
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {times.map((time, index) => (
                      <label key={`${index}-${time}`} className="flex h-14 items-center gap-4 rounded-xl border border-neutral-200 bg-white px-4 shadow-sm">
                        <span className="text-xl text-neutral-500">◷</span>
                        <input
                          aria-label={`${t('fillSchedule.scheduleTime')} ${index + 1}`}
                          type="time"
                          value={time}
                          onChange={(event) => setTime(index, event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-neutral-900 outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`${t('fillSchedule.removeTime')} ${time}`}
                          onClick={() => removeTime(time)}
                          disabled={times.length === 1}
                          className="rounded-lg p-2 text-sm font-bold text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                        >
                          x
                        </button>
                      </label>
                    ))}
                    <button
                      type="button"
                      aria-label={t('fillSchedule.addTime')}
                      onClick={addTime}
                      className="flex h-14 w-full items-center gap-4 rounded-xl border border-dashed border-neutral-300 px-4 text-left text-sm font-medium text-neutral-600 hover:border-blue-400 hover:text-blue-600"
                    >
                      <span className="text-xl">+</span>
                      <span>{t('fillSchedule.addTime')}</span>
                    </button>
                  </div>
                  <aside className="mt-5 rounded-2xl bg-blue-50/70 p-5 text-neutral-600">
                    <div className="flex items-center gap-3 text-blue-700">
                      <h4 className="font-semibold">{t('fillSchedule.tipTitle')}</h4>
                    </div>
                    <p className="mt-3 text-sm leading-6">{t('fillSchedule.tipText')}</p>
                  </aside>
                </>
              ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="flex h-14 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 shadow-sm">
                    <span className="text-sm font-medium text-neutral-600">{t('fillSchedule.oneOffDate')}</span>
                    <input
                      aria-label={t('fillSchedule.oneOffDate')}
                      type="date"
                      value={oneOffDate}
                      onChange={(event) => setOneOffDate(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-neutral-900 outline-none"
                    />
                  </label>
                  <label className="flex h-14 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 shadow-sm">
                    <span className="text-sm font-medium text-neutral-600">{t('fillSchedule.oneOffTime')}</span>
                    <input
                      aria-label={t('fillSchedule.oneOffTime')}
                      type="time"
                      value={oneOffTime}
                      onChange={(event) => setOneOffTime(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-neutral-900 outline-none"
                    />
                  </label>
                  <p className="text-xs leading-5 text-neutral-500 sm:col-span-2">
                    {t('fillSchedule.oneOffHint')} {t('fillSchedule.oneOffMinNote')}
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {!hasAccounts && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeading title={t('fillSchedule.destinationsLabel')} hint={t('fillSchedule.destinationsHelper')} />
            <div className="mt-5 space-y-4 text-sm text-neutral-600">
              <p className="text-sm leading-5 text-neutral-600">{t('fillSchedule.noAccountsHint')}</p>
              <Link
                href="/accounts"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                {t('fillSchedule.noAccountsCta')}
              </Link>
            </div>
          </section>
        )}

        {error !== null && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse items-start justify-end gap-3 pt-1 sm:flex-row">
          <Link
            href="/personas"
            className="inline-flex min-h-12 w-full shrink-0 items-center justify-center self-start rounded-xl border border-neutral-200 bg-white px-6 text-sm font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 sm:w-auto"
          >
            {t('fillSchedule.cancel')}
          </Link>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? <SpinnerIcon /> : null}
            {t('fillSchedule.activate')}
          </button>
        </div>
      </div>
      <BatchForm />
    </ScheduleShell>
  );
};

//---------------
// ScheduleShell — moldura comum (header + container).
//---------------
const ScheduleShell = ({ children }: { children: React.ReactNode }) => {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">{t('fillSchedule.title')}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t('fillSchedule.subtitle')}</p>
      </header>
      {children}
    </div>
  );
};

//---------------
// SectionHeading — título e descrição de cada bloco.
//---------------
const SectionHeading = ({ title, hint }: { title: string; hint: string }) => (
  <div>
    <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{title}</h2>
    <p className="mt-1 text-sm text-neutral-500">{hint}</p>
  </div>
);

//---------------
// AccountCard — conta social selecionável (mesmo visual do fluxo antigo).
//---------------
const AccountCard = ({
  name,
  subtitle,
  thumbnail,
  selected,
  onSelect,
}: {
  name: string;
  subtitle: string;
  thumbnail?: string;
  selected: boolean;
  onSelect: () => void;
}) => {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = Boolean(thumbnail) && !thumbnailFailed;
  const initials = (name.trim().replace(/^@+/, '').slice(0, 2) || '?').toUpperCase();
  return (
    <button
      type="button"
      title={name}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-21 w-full max-w-85 items-center gap-3 rounded-xl border px-3 text-left transition-colors sm:w-55 ${selected ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/10' : 'border-neutral-200 bg-white hover:border-blue-300'}`}
    >
      <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-neutral-500">
        {showThumbnail && thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" width={48} height={48} onError={() => setThumbnailFailed(true)} className="size-full object-cover" />
        ) : (
          <span className="text-base font-bold text-neutral-600">{initials}</span>
        )}
        {selected ? (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white">
            <CheckIcon />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm text-neutral-900">{name}</strong>
        <span className="mt-1 block text-sm text-neutral-500">{subtitle}</span>
      </span>
      <span className={`size-5 shrink-0 rounded-md border-2 ${selected ? 'border-blue-600 bg-blue-600' : 'border-neutral-300'}`}>
        {selected ? <CheckIcon /> : null}
      </span>
    </button>
  );
};

//---------------
// ScheduleSkeleton — placeholder enquanto personas/contas carregam.
//---------------
const ScheduleSkeleton = () => (
  <div className="mx-auto w-full max-w-3xl space-y-5" aria-hidden="true">
    <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
    <div className="h-64 animate-pulse rounded-2xl bg-neutral-200" />
    <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
  </div>
);
