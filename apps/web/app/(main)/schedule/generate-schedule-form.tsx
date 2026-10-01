'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  useBlueskyAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  type PersonaRecord,
} from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { computeVideoTokens, type FaceQuality } from '@/lib/tokens';
import { distributeSlots, SlotDistributionError } from '@/lib/schedule/slot-distribution';
import { isValidTimezone, parseZonedDateTime } from '@/lib/timezone';
import { scrollToErrorField } from '@/lib/scroll-to-error';
import { openUpgradeDialogIfInsufficient } from '@/lib/upgrade-dialog-store';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';

//---------------
// GenerateScheduleForm — the single generate+schedule experience.
//
// One form collects everything POST /api/videos/generate-and-schedule needs:
// persona, 1-10 topics, providers + per-provider accounts, a start date +
// times grid + timezone, and the generation options. The slot preview reuses
// distributeSlots — the SAME pure function the backend uses — so the preview
// always matches the slots the server will create.
//
// This form calls ONLY the new endpoint. The legacy generate-only /
// schedule-only endpoints are not referenced here (removed in a later phase).
//---------------

const MAX_TOPICS = 10;
// Mirrors VALID_SCHEDULE_PROVIDERS in app/api/schedule/route.ts. A local
// const keeps this client component free of server-route imports.
const PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky'] as const;
type Provider = (typeof PROVIDERS)[number];

const TIMEZONES = [
  'UTC',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Argentina/Buenos_Aires',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Rome',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
];

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ProviderAccountView {
  id: string;
  label: string;
}

interface SlotPreviewItem {
  slotAtISO: string;
  topic: string;
}

// Minimal account-query state shared by the four provider hooks (whose
// UseQueryResult generics differ per provider).
interface ProviderQueryState {
  readonly hasData: boolean;
  readonly isPending: boolean;
  readonly isError: boolean;
}

interface SubmittedSlot {
  slotId: string;
  slotAt: string;
  topic: string;
  taskId: string | null;
  status: string;
}

interface SubmitResult {
  scheduleId: string;
  slots: SubmittedSlot[];
  replayed: boolean;
}

// Server slot statuses mapped to the shared localized slot badges.
const SLOT_STATUS_KEYS: Record<string, TranslationKey> = {
  pending: 'fillSchedule.slotPending',
  generating: 'fillSchedule.slotGenerating',
  ready: 'fillSchedule.slotReady',
  published: 'fillSchedule.slotPublished',
  failed: 'fillSchedule.slotFailed',
};

function parseFaceQuality(value: unknown): FaceQuality {
  return value === 'very_good' ? 'very_good' : 'ok';
}

function perVideoCostFor(persona: PersonaRecord | undefined, faceless: boolean): number {
  if (!persona) return 1;
  const mix = faceless ? 0 : typeof persona.faceMixPercent === 'number' ? persona.faceMixPercent : 0;
  return computeVideoTokens(mix, parseFaceQuality(persona.faceQuality));
}

// Tomorrow in the browser's calendar, formatted for <input type="date">.
function defaultStartDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultTimezone(): string {
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && isValidTimezone(local)) return local;
  } catch {
    // Fall through to UTC below.
  }
  return 'UTC';
}

// Counter fallback for idempotency keys when crypto.randomUUID is
// unavailable (non-secure contexts): collision-free within the session.
let fallbackKeyCounter = 0;
function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the counter below.
  }
  fallbackKeyCounter += 1;
  return `form-${Date.now()}-${fallbackKeyCounter}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function narrowSubmittedSlot(value: unknown): SubmittedSlot | null {
  if (!isRecord(value)) return null;
  const { slotId, slotAt, topic, taskId, status } = value;
  if (
    typeof slotId !== 'string' ||
    typeof slotAt !== 'string' ||
    typeof topic !== 'string' ||
    typeof status !== 'string'
  ) {
    return null;
  }
  if (taskId !== null && typeof taskId !== 'string') return null;
  return { slotId, slotAt, topic, taskId, status };
}

export default function GenerateScheduleForm() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const personasQuery = usePersonaListQuery();
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const blueskyQuery = useBlueskyAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();

  // Normalize each provider's accounts to { id, label } using the hook
  // conventions: youtube channelId/channelName, instagram igUserId/username,
  // bluesky did/handle, linkedin providerAccountId/accountName.
  const youtubeAccounts = useMemo<ProviderAccountView[]>(
    () => (youtubeQuery.data?.accounts ?? []).map((account) => ({ id: account.channelId, label: account.channelName })),
    [youtubeQuery.data],
  );
  const instagramAccounts = useMemo<ProviderAccountView[]>(
    () => (instagramQuery.data?.accounts ?? []).map((account) => ({ id: account.igUserId, label: account.username })),
    [instagramQuery.data],
  );
  const blueskyAccounts = useMemo<ProviderAccountView[]>(
    () => (blueskyQuery.data?.accounts ?? []).map((account) => ({ id: account.did, label: account.handle })),
    [blueskyQuery.data],
  );
  const linkedinAccounts = useMemo<ProviderAccountView[]>(
    () =>
      (linkedinQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        label: account.accountName ?? account.providerAccountId,
      })),
    [linkedinQuery.data],
  );
  const providerAccounts: Record<Provider, ProviderAccountView[]> = useMemo(
    () => ({ youtube: youtubeAccounts, instagram: instagramAccounts, bluesky: blueskyAccounts, linkedin: linkedinAccounts }),
    [youtubeAccounts, instagramAccounts, blueskyAccounts, linkedinAccounts],
  );

  const providerQueryState: Record<Provider, ProviderQueryState> = useMemo(
    () => ({
      youtube: { hasData: youtubeQuery.data !== undefined, isPending: youtubeQuery.isPending, isError: youtubeQuery.isError },
      instagram: { hasData: instagramQuery.data !== undefined, isPending: instagramQuery.isPending, isError: instagramQuery.isError },
      bluesky: { hasData: blueskyQuery.data !== undefined, isPending: blueskyQuery.isPending, isError: blueskyQuery.isError },
      linkedin: { hasData: linkedinQuery.data !== undefined, isPending: linkedinQuery.isPending, isError: linkedinQuery.isError },
    }),
    [youtubeQuery, instagramQuery, blueskyQuery, linkedinQuery],
  );

  // PersonaSubmit redirects here with ?personaId= after creating a persona:
  // preselect it when it exists in the loaded list.
  const [personaId, setPersonaId] = useState<string>(() => searchParams.get('personaId') ?? '');
  useEffect(() => {
    const list = personasQuery.data;
    if (!list) return;
    if (personaId && !list.some((persona) => persona.id === personaId)) {
      setPersonaId('');
    }
  }, [personasQuery.data, personaId]);

  const [providers, setProviders] = useState<Provider[]>(['youtube']);
  // Per-provider selected account ids. Defaults to ALL connected accounts of
  // each provider once its query resolves (initialized once per provider so
  // an explicit user deselection is never clobbered).
  const [selectedAccounts, setSelectedAccounts] = useState<Record<Provider, string[]>>({
    youtube: [],
    instagram: [],
    bluesky: [],
    linkedin: [],
  });
  const initializedAccountsRef = useRef<Set<Provider>>(new Set());
  useEffect(() => {
    (Object.keys(providerAccounts) as Provider[]).forEach((provider) => {
      if (initializedAccountsRef.current.has(provider)) return;
      if (!providerQueryState[provider].hasData) return;
      initializedAccountsRef.current.add(provider);
      const ids = providerAccounts[provider].map((account) => account.id);
      setSelectedAccounts((current) => ({ ...current, [provider]: ids }));
    });
  }, [youtubeQuery.data, instagramQuery.data, blueskyQuery.data, linkedinQuery.data, providerAccounts, providerQueryState]);

  const [topics, setTopics] = useState<string[]>(['']);
  const [times, setTimes] = useState<string[]>(['12:00']);
  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [timezone, setTimezone] = useState<string>(defaultTimezone);

  const [faceless, setFaceless] = useState(false);
  const [scriptPrompt, setScriptPrompt] = useState('');
  const [imageId, setImageId] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [voiceId, setVoiceId] = useState('');

  const [balance, setBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // One idempotency key per form instance, reused across retries — never
  // regenerated per submit, so a retried request replays instead of
  // double-charging. Reset only when the user starts a brand-new batch.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newIdempotencyKey);

  useEffect(() => {
    fetchTokenBalance()
      .then((data) => setBalance(data.balance))
      .catch(() => {
        // Leave balance at 0; the estimate hint simply stays conservative.
      });
  }, []);

  const persona = useMemo(
    () => personasQuery.data?.find((entry) => entry.id === personaId),
    [personasQuery.data, personaId],
  );

  const trimmedTopics = useMemo(
    () => topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0),
    [topics],
  );
  const validTimes = useMemo(
    () => times.map((time) => time.trim()).filter((time) => TIME_RE.test(time)),
    [times],
  );

  // startAt is the instant the publishing window opens: midnight of the
  // chosen date in the chosen timezone (parseZonedDateTime interprets the
  // naive wall clock in that zone; slots strictly before it are skipped).
  const startAtISO = useMemo<string | null>(() => {
    if (!DATE_RE.test(startDate)) return null;
    const parsed = parseZonedDateTime(`${startDate}T00:00:00`, timezone);
    return parsed ? parsed.toISOString() : null;
  }, [startDate, timezone]);

  // Live slot preview — the SAME distributeSlots the backend runs, so the
  // preview always matches the slots the server will create.
  const slotPreview = useMemo<{ state: 'empty' } | { state: 'error'; message: string } | { state: 'ok'; slots: SlotPreviewItem[] }>(() => {
    if (trimmedTopics.length === 0 || validTimes.length === 0 || startAtISO === null) {
      return { state: 'empty' };
    }
    try {
      const slots = distributeSlots({
        startAtISO,
        times: validTimes,
        timezone,
        count: trimmedTopics.length,
      });
      return {
        state: 'ok',
        slots: slots.map((slot, index) => ({ slotAtISO: slot.slotAtISO, topic: trimmedTopics[index] })),
      };
    } catch (previewError) {
      return {
        state: 'error',
        message: previewError instanceof SlotDistributionError ? previewError.message : t('fillSchedule.genSlotPreviewError'),
      };
    }
  }, [trimmedTopics, validTimes, startAtISO, timezone, t]);

  const slotFormatter = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale === 'pt' ? 'pt-PT' : 'en-US', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      });
    } catch {
      return null;
    }
  }, [locale, timezone]);

  const formatSlotAt = (iso: string): string => {
    if (!slotFormatter) return iso;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return slotFormatter.format(date);
  };

  const perVideoCost = perVideoCostFor(persona, faceless);
  const estimatedCost = trimmedTopics.length * perVideoCost;

  // A provider whose accounts are still loading (or failed to load) blocks
  // submission: the user cannot meaningfully choose destinations yet, and a
  // silent empty selection would 400 on the server.
  const accountsBlocked = providers.some((provider) => {
    const state = providerQueryState[provider];
    return state.isPending || state.isError;
  });

  const toggleProvider = (provider: Provider) => {
    setProviders((current) =>
      current.includes(provider) ? current.filter((entry) => entry !== provider) : [...current, provider],
    );
  };

  const toggleAccount = (provider: Provider, accountId: string) => {
    setSelectedAccounts((current) => {
      const selected = current[provider] ?? [];
      return {
        ...current,
        [provider]: selected.includes(accountId)
          ? selected.filter((id) => id !== accountId)
          : [...selected, accountId],
      };
    });
  };

  const addTopic = () => {
    setTopics((current) => (current.length >= MAX_TOPICS ? current : [...current, '']));
  };
  const removeTopic = (index: number) => {
    setTopics((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
  };
  const setTopic = (index: number, value: string) => {
    setTopics((current) => current.map((topic, i) => (i === index ? value : topic)));
  };

  const addTime = () => setTimes((current) => [...current, '12:00']);
  const removeTime = (index: number) => {
    setTimes((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
  };
  const setTime = (index: number, value: string) => {
    setTimes((current) => current.map((time, i) => (i === index ? value : time)));
  };

  // Scroll to the field the server flagged. Tries the exact dot-path first
  // (e.g. 'topics.0', 'publishing.accounts.youtube'), then progressively
  // shorter prefixes ('publishing.schedule.times' -> 'publishing.schedule').
  const focusServerField = (field: string | undefined, code: string | undefined) => {
    if (code === 'INSUFFICIENT_TOKENS') {
      scrollToErrorField('tokens');
      return;
    }
    if (field && typeof document !== 'undefined') {
      const parts = field.split('.');
      for (let length = parts.length; length >= 1; length -= 1) {
        const candidate = parts.slice(0, length).join('.');
        if (document.querySelector(`[data-error-field="${candidate}"]`)) {
          scrollToErrorField(candidate);
          return;
        }
      }
    }
  };

  const fail = (message: string, field?: string) => {
    setError(message);
    if (field) scrollToErrorField(field);
  };

  const handleSubmit = async () => {
    setError(null);
    setResult(null);
    if (!personaId) {
      fail(t('fillSchedule.genNeedPersona'), 'personaId');
      return;
    }
    if (providers.length === 0) {
      fail(t('fillSchedule.genNeedProvider'), 'publishing.providers');
      return;
    }
    const cleanTopics = topics.map((topic) => topic.trim());
    if (cleanTopics.length === 0 || cleanTopics.some((topic) => topic.length === 0)) {
      fail(t('fillSchedule.genNeedTopics'), 'topics');
      return;
    }
    if (validTimes.length === 0) {
      fail(t('fillSchedule.genNeedTimes'), 'publishing.schedule.times');
      return;
    }
    if (startAtISO === null) {
      fail(t('fillSchedule.genNeedStartDate'), 'publishing.schedule.startAt');
      return;
    }
    for (const provider of providers) {
      if ((selectedAccounts[provider] ?? []).length === 0) {
        fail(t('fillSchedule.genNeedAccounts', { provider }), `publishing.accounts.${provider}`);
        return;
      }
    }

    const options: Record<string, string | boolean> = { faceless };
    if (scriptPrompt.trim()) options.scriptPrompt = scriptPrompt.trim();
    if (imageId.trim()) options.imageId = imageId.trim();
    if (audioUrl.trim()) options.audioUrl = audioUrl.trim();
    if (voiceId.trim()) options.voiceId = voiceId.trim();

    setSubmitting(true);
    try {
      const response = await fetch('/api/videos/generate-and-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personaId,
          topics: cleanTopics,
          publishing: {
            providers,
            accounts: Object.fromEntries(providers.map((provider) => [provider, selectedAccounts[provider] ?? []])),
            schedule: { startAt: startAtISO, times: validTimes, timezone },
          },
          options,
          idempotencyKey,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      const body = isRecord(data) ? data : null;
      if (!response.ok || !body || body.success !== true) {
        const code = typeof body?.code === 'string' ? body.code : undefined;
        // The global upgrade dialog is the product's insufficient-balance UX;
        // the actionable server message is still shown inline, as-is.
        openUpgradeDialogIfInsufficient(response.status, code);
        const message =
          typeof body?.error === 'string' && body.error ? body.error : t('fillSchedule.genSubmitFailed');
        const field = typeof body?.field === 'string' ? body.field : undefined;
        setError(message);
        focusServerField(field, code);
        return;
      }
      const schedule = isRecord(body.schedule) ? body.schedule : null;
      const scheduleId = typeof schedule?.id === 'string' ? schedule.id : null;
      const slots = Array.isArray(body.slots) ? body.slots.map(narrowSubmittedSlot).filter((slot) => slot !== null) : [];
      if (!scheduleId) {
        setError(t('fillSchedule.genSubmitFailed'));
        return;
      }
      setResult({ scheduleId, slots, replayed: body.replayed === true });
      setError(null);
      const refreshed = await fetchTokenBalance();
      setBalance(refreshed.balance);
    } catch {
      // Network failure or unreachable API: explicit error, never silent.
      setError(t('fillSchedule.genSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const startNewBatch = () => {
    setResult(null);
    setError(null);
    setTopics(['']);
    setTimes(['12:00']);
    setStartDate(defaultStartDate());
    setFaceless(false);
    setScriptPrompt('');
    setImageId('');
    setAudioUrl('');
    setVoiceId('');
    // A new batch is a new operation: fresh idempotency key.
    setIdempotencyKey(newIdempotencyKey());
  };

  // Renders the account multi-selector for one provider: loading and error
  // states are explicit — a failed accounts fetch never looks like "no
  // accounts" and never submits a silent empty selection.
  const renderProviderAccounts = (provider: Provider) => {
    const state = providerQueryState[provider];
    const accounts = providerAccounts[provider];
    const selected = selectedAccounts[provider] ?? [];

    if (state.isPending) {
      return <p className="text-sm text-[#718096]">{t('fillSchedule.genAccountsLoading')}</p>;
    }
    if (state.isError || !state.hasData) {
      return (
        <p role="alert" className="text-sm text-red-600">
          {t('fillSchedule.genAccountsError', { provider })}
        </p>
      );
    }
    if (accounts.length === 0) {
      return (
        <p className="text-sm text-[#718096]">
          {t('fillSchedule.genNoAccounts', { provider })}{' '}
          <a href="/accounts" className="font-medium text-[#101728] underline">
            {t('fillSchedule.genConnectAccounts')}
          </a>
        </p>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => (
          <label key={account.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              data-testid={`gen-account-${provider}-${account.id}`}
              checked={selected.includes(account.id)}
              onChange={() => toggleAccount(provider, account.id)}
            />
            {account.label}
          </label>
        ))}
      </div>
    );
  };

  if (result) {
    return (
      <section data-testid="gen-form" aria-label={t('fillSchedule.genTitle')} className="mt-10">
        <h2 className="text-lg font-semibold text-[#101728]">{t('fillSchedule.genSuccessTitle')}</h2>
        {result.replayed && (
          <p className="mt-1 text-sm text-[#718096]">{t('fillSchedule.genReplayedNote')}</p>
        )}
        <p className="mt-2 text-sm text-[#101728]">
          {t('fillSchedule.genScheduleIdLabel')}: <span className="font-mono">{result.scheduleId}</span>
        </p>
        <ul className="mt-4 space-y-2">
          {result.slots.map((slot) => (
            <li key={slot.slotId} className="rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm">
              <span className="font-medium text-[#101728]">{formatSlotAt(slot.slotAt)}</span>
              {' — '}
              <span className="text-[#4a5568]">{slot.topic}</span>
              {' — '}
              <span className="text-[#718096]">
                {t(SLOT_STATUS_KEYS[slot.status] ?? 'fillSchedule.genSlotStatusUnknown')}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/posts"
            className="rounded-xl bg-[#101728] px-5 py-2.5 text-sm font-semibold text-white"
          >
            {t('fillSchedule.genViewPosts')}
          </a>
          <button
            type="button"
            onClick={startNewBatch}
            className="rounded-xl border border-[#e2e8f0] px-5 py-2.5 text-sm font-semibold text-[#101728]"
          >
            {t('fillSchedule.genNewBatch')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="gen-form" aria-label={t('fillSchedule.genTitle')} className="mt-10">
      <h2 className="text-lg font-semibold text-[#101728]">{t('fillSchedule.genTitle')}</h2>
      <p className="mt-1 text-sm text-[#718096]">{t('fillSchedule.genSubtitle')}</p>

      <div className="mt-4 space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genPersonaLabel')}</span>
          <select
            data-testid="gen-persona"
            data-error-field="personaId"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value)}
            className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
          >
            <option value="">{t('fillSchedule.genPersonaPlaceholder')}</option>
            {(personasQuery.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset data-error-field="publishing.providers">
          <legend className="mb-1 text-sm font-medium text-[#101728]">{t('fillSchedule.genProvidersLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((provider) => (
              <label key={provider} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  data-testid={`gen-provider-${provider}`}
                  checked={providers.includes(provider)}
                  onChange={() => toggleProvider(provider)}
                />
                {provider}
              </label>
            ))}
          </div>
        </fieldset>

        {providers.map((provider) => (
          <div key={provider} data-error-field={`publishing.accounts.${provider}`}>
            <span className="mb-1 block text-sm font-medium text-[#101728]">
              {provider} — {t('fillSchedule.genProvidersLabel')}
            </span>
            {renderProviderAccounts(provider)}
          </div>
        ))}

        <div data-error-field="topics">
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genTopicsLabel')}</span>
          <div className="space-y-2">
            {topics.map((topic, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  data-testid={`gen-topic-${index}`}
                  data-error-field={`topics.${index}`}
                  value={topic}
                  onChange={(event) => setTopic(index, event.target.value)}
                  placeholder={t('fillSchedule.genTopicPlaceholder', { n: index + 1 })}
                  maxLength={300}
                  className="flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  data-testid={`gen-remove-topic-${index}`}
                  onClick={() => removeTopic(index)}
                  disabled={topics.length === 1}
                  className="rounded-xl border border-[#e2e8f0] px-3 text-sm disabled:opacity-40"
                  aria-label={t('fillSchedule.genRemoveTopic')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="gen-add-topic"
            onClick={addTopic}
            disabled={topics.length >= MAX_TOPICS}
            className="mt-2 text-sm font-medium text-[#101728] underline disabled:opacity-40"
          >
            {t('fillSchedule.genAddTopic')} ({topics.length}/{MAX_TOPICS})
          </button>
        </div>

        <div data-error-field="publishing.schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genStartDateLabel')}</span>
              <input
                type="date"
                data-testid="gen-start-date"
                data-error-field="publishing.schedule.startAt"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genTimezoneLabel')}</span>
              <select
                data-testid="gen-timezone"
                data-error-field="publishing.schedule.timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div data-error-field="publishing.schedule.times" className="mt-4">
            <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genTimesLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {times.map((time, index) => (
                <div key={index} className="flex items-center gap-1">
                  <input
                    type="time"
                    data-testid={`gen-time-${index}`}
                    value={time}
                    onChange={(event) => setTime(index, event.target.value)}
                    className="rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      data-testid={`gen-remove-time-${index}`}
                      onClick={() => removeTime(index)}
                      className="rounded-xl border border-[#e2e8f0] px-2 text-sm"
                      aria-label={t('fillSchedule.genRemoveTime')}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                data-testid="gen-add-time"
                onClick={addTime}
                className="text-sm font-medium text-[#101728] underline"
              >
                {t('fillSchedule.genAddTime')}
              </button>
            </div>
          </div>
        </div>

        <div data-testid="gen-slot-preview" aria-live="polite">
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.genSlotPreviewLabel')}</span>
          {slotPreview.state === 'empty' && (
            <p className="text-sm text-[#718096]">{t('fillSchedule.genSlotPreviewEmpty')}</p>
          )}
          {slotPreview.state === 'error' && (
            <p role="alert" className="text-sm text-red-600">{t('fillSchedule.genSlotPreviewError')}</p>
          )}
          {slotPreview.state === 'ok' && (
            <ul className="space-y-1">
              {slotPreview.slots.map((slot, index) => (
                <li key={index} data-testid={`gen-slot-${index}`} className="text-sm text-[#4a5568]">
                  <span className="font-medium text-[#101728]">{formatSlotAt(slot.slotAtISO)}</span>
                  {' — '}
                  {slot.topic}
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-[#101728]">{t('fillSchedule.genFacelessLabel')}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="gen-faceless"
              data-error-field="options.faceless"
              checked={faceless}
              onChange={(event) => setFaceless(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('fillSchedule.genFacelessLabel')}
              <span className="block text-xs text-[#718096]">{t('fillSchedule.genFacelessHint')}</span>
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[#101728]">
              {t('fillSchedule.genScriptPromptLabel')} ({t('fillSchedule.genOptional')})
            </span>
            <input
              type="text"
              data-testid="gen-script-prompt"
              data-error-field="options.scriptPrompt"
              value={scriptPrompt}
              onChange={(event) => setScriptPrompt(event.target.value)}
              placeholder={t('fillSchedule.genScriptPromptPlaceholder')}
              maxLength={2000}
              className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#101728]">
                {t('fillSchedule.genImageIdLabel')} ({t('fillSchedule.genOptional')})
              </span>
              <input
                type="text"
                data-testid="gen-image-id"
                data-error-field="options.imageId"
                value={imageId}
                onChange={(event) => setImageId(event.target.value)}
                className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#101728]">
                {t('fillSchedule.genAudioUrlLabel')} ({t('fillSchedule.genOptional')})
              </span>
              <input
                type="url"
                data-testid="gen-audio-url"
                data-error-field="options.audioUrl"
                value={audioUrl}
                onChange={(event) => setAudioUrl(event.target.value)}
                placeholder="https://"
                className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[#101728]">
                {t('fillSchedule.genVoiceIdLabel')} ({t('fillSchedule.genOptional')})
              </span>
              <input
                type="text"
                data-testid="gen-voice-id"
                data-error-field="options.voiceId"
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
                className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
              />
            </label>
          </div>
        </fieldset>

        <p data-testid="gen-estimate" data-error-field="tokens" className="text-sm text-[#101728]">
          {t('fillSchedule.genEstimatedCost', { cost: estimatedCost, perVideo: perVideoCost })}
          {' — '}
          {t('fillSchedule.genBalance', { balance })}
          {estimatedCost > balance && (
            <span className="font-semibold text-red-600"> {t('fillSchedule.genInsufficientHint')}</span>
          )}
        </p>

        {error && (
          <p data-testid="gen-error" role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="gen-submit"
          onClick={handleSubmit}
          disabled={submitting || accountsBlocked}
          className="rounded-xl bg-[#101728] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t('fillSchedule.genSubmitting') : t('fillSchedule.genSubmit')}
        </button>
      </div>
    </section>
  );
}
