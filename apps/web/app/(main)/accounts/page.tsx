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
import { useUploadStore } from '@/lib/store';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';
import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';
import { usePinterestOAuth } from '@/lib/oauth/pinterest-handler';
import { ProviderIcon } from '@/components/provider-icon';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';
import { AccountsIcon, GoogleIcon, InstagramIcon } from '@/lib/ui';
import { BrandIcon, connectedLabel, useDisconnectFlow } from './accounts-section-helpers';
import { ThreespeakAccountsSection } from './threespeak-accounts-section';

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
        <ThreespeakAccountsSection />
        <RumbleAccountsSection />
      </main>
    </div>
  );
}

//---------------
// Accounts page header.
//---------------

function AccountsHeader(): React.ReactElement {
  const { t } = useI18n();
  return (
    <header className="flex items-center gap-4 py-1 lg:py-2">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
        <AccountsIcon />
      </span>
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.035em] text-ink">{t('accounts.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-text lg:text-base">{t('accounts.subtitle')}</p>
      </div>
    </header>
  );
}

//---------------
// YouTube accounts: one query and one OAuth flow.
//---------------

function YoutubeAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useYouTubeAccountsQuery();
  const oauth = useYouTubeOAuth();
  const flow = useDisconnectFlow('youtube');
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.youtube);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('youtube', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-destructive-soft text-destructive"><GoogleIcon /></BrandIcon>}
      label={t('accounts.youtubeLabel')}
      description={t('accounts.youtubeDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="youtube" name={account.channelName} email={account.email} thumbnail={account.thumbnail} customUrl={account.customUrl} onSelect={() => toggle('youtube', account.channelId)} selected={selectedIds.includes(account.channelId)} showDisconnect onDisconnect={() => flow.onDisconnect(account.channelId, account.channelName)} />)}
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

//---------------
// Instagram accounts: one query and one OAuth flow.
//---------------

function InstagramAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useInstagramAccountsQuery();
  const oauth = useInstagramOAuth();
  const flow = useDisconnectFlow('instagram');
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.instagram);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('instagram', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-brand-soft text-brand"><InstagramIcon /></BrandIcon>}
      label={t('accounts.instagramLabel')}
      description={t('accounts.instagramDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="instagram" name={`@${account.username}`} storedDisplayName={account.name} thumbnail={account.profilePictureUrl} onSelect={() => toggle('instagram', account.igUserId)} selected={selectedIds.includes(account.igUserId)} showDisconnect onDisconnect={() => flow.onDisconnect(account.igUserId, `@${account.username}`)} />)}
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



//---------------
// LinkedIn accounts: one query and one OAuth flow.
//---------------

function LinkedinAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useLinkedinAccountsQuery();
  const oauth = useLinkedInOAuth();
  const flow = useDisconnectFlow('linkedin');
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('linkedin', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-info-soft text-info"><LinkedinIcon /></BrandIcon>}
      label={t('accounts.linkedinLabel')}
      description={t('accounts.linkedinDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <LinkedinAccountCard key={account.recordId} name={account.accountName || account.providerAccountId} thumbnail={account.profilePictureUrl} storedDisplayName={account.accountMetadata?.name ?? undefined} labelOrigin={account.accountName ? 'stored' : 'provider_id'} isOrganization={account.providerAccountId.startsWith('urn:li:organization:')} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName || account.providerAccountId)} />)}
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


//---------------
// Threads accounts: one query and one OAuth flow.
//---------------

function ThreadsAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useThreadsAccountsQuery();
  const oauth = useThreadsOAuth();
  const flow = useDisconnectFlow('threads');
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('threads', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-muted text-foreground"><ProviderIcon provider="threads" /></BrandIcon>}
      label={t('accounts.threadsLabel')}
      description={t('accounts.threadsDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="threads" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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

//---------------
// Facebook Pages: one query and one OAuth flow. Each managed Page is its
// own account (connecting once adds every Page the user manages).
//---------------

function FacebookAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useFacebookAccountsQuery();
  const oauth = useFacebookOAuth();
  const flow = useDisconnectFlow('facebook');
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('facebook', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-muted"><ProviderIcon provider="facebook" /></BrandIcon>}
      label={t('accounts.facebookLabel')}
      description={t('accounts.facebookDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="facebook" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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

//---------------
// Pinterest: one query and one OAuth flow. Connecting once adds the
// Pinterest account; the boards its pins go to come from
// GET /api/pinterest/boards at schedule time.
//---------------

function PinterestAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = usePinterestAccountsQuery();
  const oauth = usePinterestOAuth();
  const flow = useDisconnectFlow('pinterest');
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('pinterest', query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-muted"><ProviderIcon provider="pinterest" /></BrandIcon>}
      label={t('accounts.pinterestLabel')}
      description={t('accounts.pinterestDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="pinterest" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} thumbnail={account.profilePictureUrl} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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

//---------------
// LinkedIn card that distinguishes a member profile from a company page.
//---------------

function LinkedinAccountCard({ name, thumbnail, storedDisplayName, labelOrigin, isOrganization, showDisconnect, onDisconnect }: { name: string; thumbnail?: string; storedDisplayName?: string; labelOrigin?: 'stored' | 'provider_id'; isOrganization: boolean; showDisconnect?: boolean; onDisconnect?: () => void }): ReactNode {
  const { t } = useI18n();
  return <div className="relative"><AccountCard type="linkedin" name={name} thumbnail={thumbnail} storedDisplayName={storedDisplayName} labelOrigin={labelOrigin} showDisconnect={showDisconnect} onDisconnect={onDisconnect} /><span className="absolute top-2 right-2 rounded border border-info/30 bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">{t(isOrganization ? 'accounts.pageBadge' : 'accounts.memberBadge')}</span></div>;
}


function LinkedinIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>;
}
