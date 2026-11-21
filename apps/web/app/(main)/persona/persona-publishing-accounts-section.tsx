'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
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
  useThreadsAccountsQuery,
  useFacebookAccountsQuery,
  useThreespeakAccountsQuery,
} from '@/lib/api';
import { useRumbleAccountsQuery, useTelegramAccountsQuery } from '@/lib/social-accounts-queries';
import { usePinterestAccountsQuery } from '@/lib/pinterest-accounts';
import { useFanvueAccountsQuery } from '@/lib/fanvue-accounts';
import { useI18n } from '@/lib/i18n/provider';
import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { emptyPersonaDefaultAccounts, totalBoundAccounts } from '@/lib/persona-publishing-accounts';
import { usePersonaStore } from '@/lib/store';

type PublishingProvider = SocialProvider;
type PublishingBinding = Record<PublishingProvider, string[]>;

const PROVIDERS: readonly { provider: PublishingProvider; label: string }[] = SOCIAL_PROVIDERS.map((provider) => ({
  provider,
  label: PROVIDER_LABELS[provider],
}));

const EMPTY_BINDING: PublishingBinding = emptyPersonaDefaultAccounts();

interface BindingResponse {
  success: boolean;
  defaults?: unknown;
  error?: string;
}

function normalizeBinding(raw: unknown): PublishingBinding {
  const out: PublishingBinding = { ...EMPTY_BINDING };
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

function describeFailure(fallback: string, body: BindingResponse): string {
  return typeof body.error === 'string' && body.error !== '' ? body.error : fallback;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchBinding(personaId: string, loadError: string): Promise<PublishingBinding> {
  if (!UUID_SHAPE.test(personaId)) {
    logger.warn('[persona-publishing-accounts] non-uuid personaId; skipping binding fetch', {
      personaId,
    });
    return emptyPersonaDefaultAccounts();
  }
  const res = await fetch(`/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`);
  if (!res.ok) notifyIfSessionExpired(res);
  const body = (await res.json()) as BindingResponse;
  if (!res.ok || body.success !== true) throw new Error(describeFailure(loadError, body));
  return normalizeBinding(body.defaults);
}

interface CardAccount {
  id: string;
  card: React.ReactNode;
}

export function PersonaPublishingAccountsSection({ personaId }: { personaId?: string }) {
  const { t } = useI18n();
  const youtube = useYouTubeAccountsQuery();
  const instagram = useInstagramAccountsQuery();
  const bluesky = useBlueskyAccountsQuery();
  const linkedin = useLinkedinAccountsQuery();
  const threads = useThreadsAccountsQuery();
  const facebook = useFacebookAccountsQuery();
  const pinterest = usePinterestAccountsQuery();
  const threespeak = useThreespeakAccountsQuery();
  const rumble = useRumbleAccountsQuery();
  const fanvue = useFanvueAccountsQuery();
  const telegram = useTelegramAccountsQuery();

  const isDraft = personaId === undefined;
  const draftSelection = usePersonaStore((s) => s.publishingAccounts);
  const setDraftSelection = usePersonaStore((s) => s.setPublishingAccounts);
  const setPublishingAccountsLoaded = usePersonaStore((s) => s.setPublishingAccountsLoaded);
  const submitResult = usePersonaStore((s) => s.result);
  const selection = draftSelection;
  const [loading, setLoading] = useState(!isDraft);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (personaId === undefined) return;
    setLoading(true);
    setLoadError(null);
    try {
      const binding = await fetchBinding(personaId, t('persona.publishingAccountsLoadError'));
      if (UUID_SHAPE.test(personaId)) setDraftSelection(binding);
      setPublishingAccountsLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('persona.publishingAccountsLoadError'));
      setPublishingAccountsLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [personaId, t, setDraftSelection, setPublishingAccountsLoaded]);

  useEffect(() => {
    if (isDraft) {
      setPublishingAccountsLoaded(true);
      return;
    }
    setPublishingAccountsLoaded(false);
    void load();
  }, [load, isDraft, setPublishingAccountsLoaded]);

  const toggle = (provider: PublishingProvider, id: string) => {
    const current = draftSelection[provider];
    setDraftSelection({
      ...draftSelection,
      [provider]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    });
  };

  const mustSelectError = isDraft
    ? submitResult !== null && !submitResult.success && submitResult.error === t('publishing.mustSelectAccount')
    : !loading && loadError === null && totalBoundAccounts(selection) === 0;

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
          storedDisplayName={account.name}
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
          storedDisplayName={account.accountMetadata?.name ?? undefined}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          selected={selection.linkedin.includes(account.providerAccountId)}
          onSelect={() => toggle('linkedin', account.providerAccountId)}
        />
      ),
    })),
    threads: (threads.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`threads:${account.providerAccountId}`}
          type="threads"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          thumbnail={account.profilePictureUrl}
          selected={selection.threads.includes(account.providerAccountId)}
          onSelect={() => toggle('threads', account.providerAccountId)}
        />
      ),
    })),
    facebook: (facebook.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`facebook:${account.providerAccountId}`}
          type="facebook"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          thumbnail={account.profilePictureUrl}
          selected={selection.facebook.includes(account.providerAccountId)}
          onSelect={() => toggle('facebook', account.providerAccountId)}
        />
      ),
    })),
    pinterest: (pinterest.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`pinterest:${account.providerAccountId}`}
          type="pinterest"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          thumbnail={account.profilePictureUrl}
          selected={selection.pinterest.includes(account.providerAccountId)}
          onSelect={() => toggle('pinterest', account.providerAccountId)}
        />
      ),
    })),
    '3speak': (threespeak.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`threespeak:${account.providerAccountId}`}
          type="3speak"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          selected={selection['3speak'].includes(account.providerAccountId)}
          onSelect={() => toggle('3speak', account.providerAccountId)}
        />
      ),
    })),
    rumble: (rumble.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`rumble:${account.providerAccountId}`}
          type="rumble"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          selected={selection.rumble.includes(account.providerAccountId)}
          onSelect={() => toggle('rumble', account.providerAccountId)}
        />
      ),
    })),
    fanvue: (fanvue.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`fanvue:${account.providerAccountId}`}
          type="fanvue"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          thumbnail={account.profilePictureUrl}
          selected={selection.fanvue.includes(account.providerAccountId)}
          onSelect={() => toggle('fanvue', account.providerAccountId)}
        />
      ),
    })),
    telegram: (telegram.data?.accounts ?? []).map((account) => ({
      id: account.providerAccountId,
      card: (
        <AccountCard
          key={`telegram:${account.providerAccountId}`}
          type="telegram"
          name={account.accountName ?? account.providerAccountId}
          labelOrigin={account.accountName ? 'stored' : 'provider_id'}
          selected={selection.telegram.includes(account.providerAccountId)}
          onSelect={() => toggle('telegram', account.providerAccountId)}
        />
      ),
    })),
  };

  return (
    <section data-error-field="accounts">
      <SectionDivider label={t('persona.publishingAccountsLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
        <p className="text-sm text-muted-text">{t('persona.publishingAccountsHint')}</p>
        {mustSelectError ? <InlineFieldError message={t('publishing.mustSelectAccount')} /> : null}
        {loading ? (
          <div data-testid="publishing-accounts-loading" className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-sunken" />
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
                      <p className="text-sm font-semibold text-ink">{label}</p>
                      <Badge variant="secondary" className="text-[11px]">
                        {cards.length}
                      </Badge>
                    </div>
                    {cards.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-text">
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
          </>
        )}
      </div>
    </section>
  );
}
