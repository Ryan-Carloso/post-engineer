'use client';

import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import SocialAccountsSection from '@/components/ui/social-accounts-section';
import {
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useThreadsAccountsQuery,
  useFacebookAccountsQuery,
  useYouTubeAccountsQuery,
} from '@/lib/api';
import {
  BlueskyAccountsSection,
  RumbleAccountsSection,
} from './credential-accounts-sections';
import { usePinterestAccountsQuery } from '@/lib/pinterest-accounts';
import { useFanvueAccountsQuery } from '@/lib/fanvue-accounts';
import { useUploadStore } from '@/lib/store';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';
import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';
import { usePinterestOAuth } from '@/lib/oauth/pinterest-handler';
import { useFanvueOAuth } from '@/lib/oauth/fanvue-handler';
import { ProviderBrandIcon } from '@/components/provider-brand-icon';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';
import { AccountsHeader } from './accounts-header';
import { connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';
import { ThreespeakAccountsSection } from './threespeak-accounts-section';
import { TelegramAccountsSection } from './telegram-accounts-section';

export default function AccountsPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <AccountsHeader />
      <main className="flex flex-col gap-5 lg:gap-6">
        <YoutubeAccountsSection />
        <InstagramAccountsSection />
        <BlueskyAccountsSection />
        <LinkedinAccountsSection />
        <ThreadsAccountsSection />
        <FacebookAccountsSection />
        <PinterestAccountsSection />
        <FanvueAccountsSection />
        <ThreespeakAccountsSection />
        <RumbleAccountsSection />
        <TelegramAccountsSection />
      </main>
    </div>
  );
}

function YoutubeAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useYouTubeAccountsQuery();
  const oauth = useYouTubeOAuth();
  const flow = useDisconnectFlow('youtube');
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.youtube);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('youtube', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="youtube" />}
      label={t('accounts.youtubeLabel')}
      description={t('accounts.youtubeDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="youtube" name={account.channelName} email={account.email} thumbnail={account.thumbnail} customUrl={account.customUrl} onSelect={() => toggle('youtube', account.channelId)} selected={selectedIds.includes(account.channelId)} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.channelId, account.channelName)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}

function InstagramAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useInstagramAccountsQuery();
  const oauth = useInstagramOAuth();
  const flow = useDisconnectFlow('instagram');
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.instagram);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('instagram', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="instagram" />}
      label={t('accounts.instagramLabel')}
      description={t('accounts.instagramDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="instagram" name={`@${account.username}`} storedDisplayName={account.name} thumbnail={account.profilePictureUrl} onSelect={() => toggle('instagram', account.igUserId)} selected={selectedIds.includes(account.igUserId)} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.igUserId, `@${account.username}`)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}



function LinkedinAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useLinkedinAccountsQuery();
  const oauth = useLinkedInOAuth();
  const flow = useDisconnectFlow('linkedin');
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('linkedin', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="linkedin" />}
      label={t('accounts.linkedinLabel')}
      description={t('accounts.linkedinDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <LinkedinAccountCard key={account.recordId} name={account.accountName || account.providerAccountId} thumbnail={account.profilePictureUrl} storedDisplayName={account.accountMetadata?.name ?? undefined} labelOrigin={account.accountName ? 'stored' : 'provider_id'} isOrganization={account.providerAccountId.startsWith('urn:li:organization:')} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName || account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}


function ThreadsAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useThreadsAccountsQuery();
  const oauth = useThreadsOAuth();
  const flow = useDisconnectFlow('threads');
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('threads', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="threads" />}
      label={t('accounts.threadsLabel')}
      description={t('accounts.threadsDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="threads" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}

function FacebookAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useFacebookAccountsQuery();
  const oauth = useFacebookOAuth();
  const flow = useDisconnectFlow('facebook');
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('facebook', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="facebook" />}
      label={t('accounts.facebookLabel')}
      description={t('accounts.facebookDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="facebook" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}

function PinterestAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = usePinterestAccountsQuery();
  const oauth = usePinterestOAuth();
  const flow = useDisconnectFlow('pinterest');
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('pinterest', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="pinterest" />}
      label={t('accounts.pinterestLabel')}
      description={t('accounts.pinterestDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="pinterest" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}

function FanvueAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useFanvueAccountsQuery();
  const oauth = useFanvueOAuth();
  const flow = useDisconnectFlow('fanvue');
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('fanvue', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="fanvue" />}
      label={t('accounts.fanvueLabel')}
      description={t('accounts.fanvueDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="fanvue" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={flow.disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
      dialog={flow.dialog}
    />
  );
}

function LinkedinAccountCard({ name, thumbnail, storedDisplayName, labelOrigin, isOrganization, showDisconnect, onDisconnect, error, onReconnect }: { name: string; thumbnail?: string; storedDisplayName?: string; labelOrigin?: 'stored' | 'provider_id'; isOrganization: boolean; showDisconnect?: boolean; onDisconnect?: () => void; error?: boolean; onReconnect?: () => void }): ReactNode {
  const { t } = useI18n();
  return <div className="relative"><AccountCard type="linkedin" name={name} thumbnail={thumbnail} storedDisplayName={storedDisplayName} labelOrigin={labelOrigin} showDisconnect={showDisconnect} onDisconnect={onDisconnect} error={error} onReconnect={onReconnect} /><span className="absolute top-2 right-2 rounded border border-info/30 bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">{t(isOrganization ? 'accounts.pageBadge' : 'accounts.memberBadge')}</span></div>;
}


