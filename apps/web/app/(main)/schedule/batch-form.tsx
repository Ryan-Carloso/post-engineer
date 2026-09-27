'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePersonaListQuery, type PersonaRecord } from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { computeVideoTokens, type FaceQuality } from '@/lib/tokens';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// BatchForm — manual finite video batch (1-30 videos).
//
// Each topic row becomes exactly one video. Tokens are deducted upfront by
// POST /api/schedule/batch; the slots are generated at the 06:00 UTC cutoff.
// Shows a live cost estimate (topics x per-video cost) against the balance.
//---------------

const MAX_TOPICS = 30;
// Bluesky is intentionally not offered: batch publishing requires per-provider
// account ids and the engine has no bluesky target support.
const BATCH_PROVIDER_IDS = ['youtube', 'instagram', 'linkedin'] as const;

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

function parseFaceQuality(value: unknown): FaceQuality {
  return value === 'very_good' ? 'very_good' : 'ok';
}

function perVideoCostFor(persona: PersonaRecord | undefined): number {
  if (!persona) return 1;
  const mix = typeof persona.faceMixPercent === 'number' ? persona.faceMixPercent : 0;
  return computeVideoTokens(mix, parseFaceQuality(persona.faceQuality));
}

export default function BatchForm() {
  const { t } = useI18n();
  const personasQuery = usePersonaListQuery();

  const [personaId, setPersonaId] = useState('');
  const [providers, setProviders] = useState<string[]>(['youtube']);
  const [topics, setTopics] = useState<string[]>(['']);
  const [times, setTimes] = useState<string[]>(['12:00']);
  const [timezone, setTimezone] = useState(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return TIMEZONES.includes(local) ? local : 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [balance, setBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
  const perVideoCost = perVideoCostFor(persona);
  const estimatedCost = topics.length * perVideoCost;

  const toggleProvider = (provider: string) => {
    setProviders((current) =>
      current.includes(provider) ? current.filter((entry) => entry !== provider) : [...current, provider],
    );
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

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!personaId) {
      setError(t('fillSchedule.batchNeedPersona'));
      return;
    }
    if (providers.length === 0) {
      setError(t('fillSchedule.batchNeedProvider'));
      return;
    }
    const trimmedTopics = topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0);
    if (trimmedTopics.length !== topics.length) {
      setError(t('fillSchedule.batchNeedTopics'));
      return;
    }
    const validTimes = times.filter((time) => /^\d{2}:\d{2}$/.test(time));
    if (validTimes.length === 0) {
      setError(t('fillSchedule.batchNeedTimes'));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/schedule/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personaId,
          items: trimmedTopics.map((topic) => ({ topic })),
          providers,
          times: validTimes,
          timezone,
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        tokensSpent?: number;
        slots?: { topic: string; slotAt: string }[];
      };
      if (!response.ok || !data.success) {
        // 400s carry the real backend message (e.g. INSUFFICIENT_TOKENS).
        setError(typeof data.error === 'string' && data.error ? data.error : t('fillSchedule.batchSubmitFailed'));
        return;
      }
      setSuccess(
        t('fillSchedule.batchSuccess', {
          count: data.slots?.length ?? trimmedTopics.length,
          tokens: data.tokensSpent ?? estimatedCost,
        }),
      );
      setTopics(['']);
      setError(null);
      const refreshed = await fetchTokenBalance();
      setBalance(refreshed.balance);
    } catch {
      setError(t('fillSchedule.batchSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section data-testid="batch-form" aria-label={t('fillSchedule.batchTitle')} className="mt-10">
      <h2 className="text-lg font-semibold text-[#101728]">{t('fillSchedule.batchTitle')}</h2>
      <p className="mt-1 text-sm text-[#718096]">{t('fillSchedule.batchSubtitle')}</p>

      <div className="mt-4 space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.batchPersonaLabel')}</span>
          <select
            data-testid="batch-persona"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value)}
            className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
          >
            <option value="">{t('fillSchedule.batchPersonaPlaceholder')}</option>
            {(personasQuery.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-[#101728]">{t('fillSchedule.batchProvidersLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {BATCH_PROVIDER_IDS.map((provider) => (
              <label key={provider} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  data-testid={`batch-provider-${provider}`}
                  checked={providers.includes(provider)}
                  onChange={() => toggleProvider(provider)}
                />
                {provider}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.batchTopicsLabel')}</span>
          <div className="space-y-2">
            {topics.map((topic, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  data-testid={`batch-topic-${index}`}
                  value={topic}
                  onChange={(event) => setTopic(index, event.target.value)}
                  placeholder={t('fillSchedule.batchTopicPlaceholder', { n: index + 1 })}
                  maxLength={500}
                  className="flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  data-testid={`batch-remove-topic-${index}`}
                  onClick={() => removeTopic(index)}
                  disabled={topics.length === 1}
                  className="rounded-xl border border-[#e2e8f0] px-3 text-sm disabled:opacity-40"
                  aria-label={t('fillSchedule.batchRemoveTopic')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="batch-add-topic"
            onClick={addTopic}
            disabled={topics.length >= MAX_TOPICS}
            className="mt-2 text-sm font-medium text-[#101728] underline disabled:opacity-40"
          >
            {t('fillSchedule.batchAddTopic')} ({topics.length}/{MAX_TOPICS})
          </button>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.batchTimesLabel')}</span>
          <div className="flex flex-wrap gap-2">
            {times.map((time, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  type="time"
                  data-testid={`batch-time-${index}`}
                  value={time}
                  onChange={(event) => setTime(index, event.target.value)}
                  className="rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm"
                />
                {times.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTime(index)}
                    className="rounded-xl border border-[#e2e8f0] px-2 text-sm"
                    aria-label={t('fillSchedule.batchRemoveTime')}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addTime}
              className="text-sm font-medium text-[#101728] underline"
            >
              {t('fillSchedule.batchAddTime')}
            </button>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-[#101728]">{t('fillSchedule.batchTimezoneLabel')}</span>
          <select
            data-testid="batch-timezone"
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

        <p data-testid="batch-estimate" className="text-sm text-[#101728]">
          {t('fillSchedule.batchEstimatedCost', { cost: estimatedCost, perVideo: perVideoCost })}
          {' — '}
          {t('fillSchedule.batchBalance', { balance })}
          {estimatedCost > balance && (
            <span className="font-semibold text-red-600"> {t('fillSchedule.batchInsufficientHint')}</span>
          )}
        </p>

        {error && (
          <p data-testid="batch-error" role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        )}
        {success && (
          <p data-testid="batch-success" role="status" className="text-sm font-medium text-green-700">
            {success}
          </p>
        )}

        <button
          type="button"
          data-testid="batch-submit"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-xl bg-[#101728] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t('fillSchedule.batchSubmitting') : t('fillSchedule.batchSubmit')}
        </button>
      </div>
    </section>
  );
}
