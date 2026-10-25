'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import Link from 'next/link';
import AccountCard from '@/components/account-card';
import { ProviderIcon } from '@/components/provider-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useBlueskyAccountsQuery,
  useLinkedinAccountsQuery,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { SpinnerIcon } from '@/lib/ui';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

//---------------
// PersonaPublishingAccountsSection — per-persona default publishing accounts
// (issue #212). When a video is generated without explicit accounts, the API
// falls back to these defaults; an explicit account choice always wins.
//
// The section loads the saved defaults with GET
// /api/persona/publishing-accounts?personaId=<uuid> and persists the whole
// selection with PUT to the same route. Toggling a checkbox only updates
// local state — nothing is sent until Save.
//---------------

type PublishingProvider = 'youtube' | 'instagram' | 'bluesky' | 'linkedin';
type PublishingDefaults = Record<PublishingProvider, string[]>;

const PROVIDERS: readonly { provider: PublishingProvider; label: string }[] = [
  { provider: 'youtube', label: 'YouTube' },
  { provider: 'instagram', label: 'Instagram' },
  { provider: 'bluesky', label: 'Bluesky' },
  { provider: 'linkedin', label: 'LinkedIn' },
];

const EMPTY_DEFAULTS: PublishingDefaults = { youtube: [], instagram: [], bluesky: [], linkedin: [] };

//---------------
// API helpers — the route is built in parallel (issue #212); the contract is
// pinned here so the UI can be tested against mocks until it lands.
//---------------

interface DefaultsResponse {
  success: boolean;
  defaults?: unknown;
  error?: string;
}

function normalizeDefaults(raw: unknown): PublishingDefaults {
  const out: PublishingDefaults = { ...EMPTY_DEFAULTS };
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const { provider } of PROVIDERS) {
      const value = record[provider];
      if (Array.isArray(value)) {
        out[provider] = value.filter((id): id is string => typeof id === 'string');
      }
    }
  }
  return out;
}

function describeFailure(fallback: string, body: DefaultsResponse): string {
  return typeof body.error === 'string' && body.error !== '' ? body.error : fallback;
}

// Same uuid shape the API route validates server-side: a non-uuid id here is
// a placeholder from an un-persisted persona, never a fetchable row.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchDefaults(personaId: string, loadError: string): Promise<PublishingDefaults> {
  // The section only runs fetches for a persisted persona; a non-uuid id
  // means a placeholder reached this component (the same caller that
  // produced the 15 production "invalid uuid 'p-1'" warnings) — no fetch,
  // no 400, defaults stay empty until the persona exists.
  if (!UUID_SHAPE.test(personaId)) {
    logger.warn('[persona-publishing-accounts] non-uuid personaId; skipping defaults fetch', {
      personaId,
    });
    return { youtube: [], instagram: [], bluesky: [], linkedin: [] };
  }
  const res = await fetch(`/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`);
  const body = (await res.json()) as DefaultsResponse;
  if (!res.ok || body.success !== true) throw new Error(describeFailure(loadError, body));
  return normalizeDefaults(body.defaults);
}

async function saveDefaults(
  personaId: string,
  accounts: PublishingDefaults,
  saveError: string,
): Promise<PublishingDefaults> {
  const res = await fetch(`/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accounts }),
  });
  const body = (await res.json()) as DefaultsResponse;
  if (!res.ok || body.success !== true) throw new Error(describeFailure(saveError, body));
  return normalizeDefaults(body.defaults);
}

//---------------
// Account id extraction — mirrors NewPostAccountsField (posts/new): the id
// field differs per provider (channelId / igUserId / did / providerAccountId).
//---------------

interface CardAccount {
  id: string;
  card: React.ReactNode;
}

export function PersonaPublishingAccountsSection({ personaId }: { personaId: string }) {
  const { t } = useI18n();
  const youtube = useYouTubeAccountsQuery();
  const instagram = useInstagramAccountsQuery();
  const bluesky = useBlueskyAccountsQuery();
  const linkedin = useLinkedinAccountsQuery();

  const [selection, setSelection] = useState<PublishingDefaults>(EMPTY_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSelection(await fetchDefaults(personaId, t('persona.publishingAccountsLoadError')));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('persona.publishingAccountsLoadError'));
    } finally {
      setLoading(false);
    }
  }, [personaId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (provider: PublishingProvider, id: string) => {
    setSaved(false);
    setSaveError(null);
    setSelection((prev) => {
      const current = prev[provider];
      return {
        ...prev,
        [provider]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      };
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      setSelection(await saveDefaults(personaId, selection, t('persona.publishingAccountsSaveError')));
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('persona.publishingAccountsSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const connectedByProvider: Record<PublishingProvider, CardAccount[]> = {
    youtube: (youtube.data?.accounts ?? []).map((account) => ({
      id: account.channelId,
      card: (
        <AccountCard
          key={`youtube:${account.channelId}`}
          type="youtube"
          name={account.channelName}
          email={account.email}
          thumbnail={account.thumbnail}
          selected={selection.youtube.includes(account.channelId)}
          onSelect={() => toggle('youtube', account.channelId)}
        />
      ),
    })),
    instagram: (instagram.data?.accounts ?? []).map((account) => ({
      id: account.igUserId,
      card: (
        <AccountCard
          key={`instagram:${account.igUserId}`}
          type="instagram"
          name={`@${account.username}`}
          thumbnail={account.profilePictureUrl}
          selected={selection.instagram.includes(account.igUserId)}
          onSelect={() => toggle('instagram', account.igUserId)}
        />
      ),
    })),
    bluesky: (bluesky.data?.accounts ?? []).map((account) => ({
      id: account.did,
      card: (
        <AccountCard
          key={`bluesky:${account.did}`}
          type="bluesky"
          name={account.handle}
          handle={`@${account.handle}`}
          selected={selection.bluesky.includes(account.did)}
          onSelect={() => toggle('bluesky', account.did)}
        />
      ),
    })),
    linkedin: (linkedin.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`linkedin:${account.providerAccountId}`}
          type="linkedin"
          name={account.accountName ?? account.providerAccountId}
          selected={selection.linkedin.includes(account.providerAccountId)}
          onSelect={() => toggle('linkedin', account.providerAccountId)}
        />
      ),
    })),
  };

  const accountsLoading =
    youtube.isLoading || instagram.isLoading || bluesky.isLoading || linkedin.isLoading;

  return (
    <section>
      <SectionDivider label={t('persona.publishingAccountsLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm text-neutral-600">{t('persona.publishingAccountsHint')}</p>
        {loading ? (
          <div data-testid="publishing-accounts-loading" className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-neutral-100" />
            ))}
          </div>
        ) : loadError !== null ? (
          <div>
            <InlineFieldError message={loadError} />
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
              data-testid="publishing-accounts-retry"
            >
              {t('persona.tryAgain')}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-5">
              {PROVIDERS.map(({ provider, label }) => {
                const cards = connectedByProvider[provider];
                return (
                  <div key={provider}>
                    <div className="flex items-center gap-2">
                      <ProviderIcon provider={provider} />
                      <p className="text-sm font-semibold text-neutral-900">{label}</p>
                      <Badge variant="secondary" className="text-[11px]">
                        {cards.length}
                      </Badge>
                    </div>
                    {cards.length === 0 ? (
                      <p className="mt-2 text-sm text-neutral-500">
                        {t('persona.publishingAccountsNoAccounts', { provider: label })}{' '}
                        <Link href="/accounts" className="font-medium text-accent underline">
                          {t('persona.connectAccounts')}
                        </Link>
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-1 gap-3">
                        {cards.map((item) => item.card)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void save()}
                disabled={saving || accountsLoading}
                data-testid="publishing-accounts-save"
              >
                {saving && <SpinnerIcon />}
                {t(saving ? 'persona.publishingAccountsSaving' : 'persona.publishingAccountsSave')}
              </Button>
              {saved && (
                <p role="status" className="text-sm font-medium text-emerald-700">
                  {t('persona.publishingAccountsSaved')}
                </p>
              )}
            </div>
            {saveError !== null && <InlineFieldError message={saveError} />}
          </>
        )}
      </div>
    </section>
  );
}
