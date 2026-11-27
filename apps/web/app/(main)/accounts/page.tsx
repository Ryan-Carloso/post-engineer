'use client';

import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
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
import { useI18n } from '@/lib/i18n/provider';
import { AccountsHeader } from './accounts-header';
import type { OAuthConnectProvider } from '@/lib/contracts/providers';
import { ProviderAccountsSection, storedLabelOrigin, storedName, type StoredNameAccount } from './provider-accounts-section';
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
  const oauth = useYouTubeOAuth();
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.youtube);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  return (
    <ProviderAccountsSection
      provider="youtube"
      labelKey="accounts.youtubeLabel"
      descriptionKey="accounts.youtubeDescription"
      query={useYouTubeAccountsQuery()}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type="youtube" name={account.channelName} email={account.email} thumbnail={account.thumbnail} customUrl={account.customUrl} onSelect={() => toggle('youtube', account.channelId)} selected={selectedIds.includes(account.channelId)} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => onDisconnect(account.channelId, account.channelName)} />}
      onConnect={() => void oauth.startOAuth()}
      connectError={oauth.error}
      connectDisabled={oauth.isLoading}
    />
  );
}

function InstagramAccountsSection(): ReactNode {
  const oauth = useInstagramOAuth();
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.instagram);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  return (
    <ProviderAccountsSection
      provider="instagram"
      labelKey="accounts.instagramLabel"
      descriptionKey="accounts.instagramDescription"
      query={useInstagramAccountsQuery()}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type="instagram" name={`@${account.username}`} storedDisplayName={account.name} thumbnail={account.profilePictureUrl} onSelect={() => toggle('instagram', account.igUserId)} selected={selectedIds.includes(account.igUserId)} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => onDisconnect(account.igUserId, `@${account.username}`)} />}
      onConnect={() => void oauth.startOAuth()}
      connectError={oauth.error}
      connectDisabled={oauth.isLoading}
    />
  );
}

function LinkedinAccountsSection(): ReactNode {
  const oauth = useLinkedInOAuth();
  return (
    <ProviderAccountsSection
      provider="linkedin"
      labelKey="accounts.linkedinLabel"
      descriptionKey="accounts.linkedinDescription"
      query={useLinkedinAccountsQuery()}
      renderAccount={(account, onDisconnect) => <LinkedinAccountCard key={account.recordId} name={account.accountName || account.providerAccountId} thumbnail={account.profilePictureUrl} storedDisplayName={account.accountMetadata?.name ?? undefined} labelOrigin={account.accountName ? 'stored' : 'provider_id'} isOrganization={account.providerAccountId.startsWith('urn:li:organization:')} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => onDisconnect(account.providerAccountId, account.accountName || account.providerAccountId)} />}
      onConnect={() => void oauth.startOAuth()}
      connectError={oauth.error}
      connectDisabled={oauth.isLoading}
    />
  );
}

interface StoredOAuthAccount extends StoredNameAccount {
  status?: string;
  profilePictureUrl?: string;
}

function StoredOAuthAccountsSection<Account extends StoredOAuthAccount>({ provider, query, oauth }: { provider: OAuthConnectProvider; query: Parameters<typeof ProviderAccountsSection<Account>>[0]['query']; oauth: { startOAuth: () => Promise<void>; error: string | null; isLoading: boolean } }): ReactNode {
  return (
    <ProviderAccountsSection
      provider={provider}
      labelKey={`accounts.${provider}Label`}
      descriptionKey={`accounts.${provider}Description`}
      query={query}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type={provider} name={storedName(account)} labelOrigin={storedLabelOrigin(account)} thumbnail={account.profilePictureUrl} error={account.status === 'error'} onReconnect={() => void oauth.startOAuth()} showDisconnect onDisconnect={() => onDisconnect(account.providerAccountId, storedName(account))} />}
      onConnect={() => void oauth.startOAuth()}
      connectError={oauth.error}
      connectDisabled={oauth.isLoading}
    />
  );
}

function ThreadsAccountsSection(): ReactNode {
  return <StoredOAuthAccountsSection provider="threads" query={useThreadsAccountsQuery()} oauth={useThreadsOAuth()} />;
}

function FacebookAccountsSection(): ReactNode {
  return <StoredOAuthAccountsSection provider="facebook" query={useFacebookAccountsQuery()} oauth={useFacebookOAuth()} />;
}

function PinterestAccountsSection(): ReactNode {
  return <StoredOAuthAccountsSection provider="pinterest" query={usePinterestAccountsQuery()} oauth={usePinterestOAuth()} />;
}

function FanvueAccountsSection(): ReactNode {
  return <StoredOAuthAccountsSection provider="fanvue" query={useFanvueAccountsQuery()} oauth={useFanvueOAuth()} />;
}

function LinkedinAccountCard({ name, thumbnail, storedDisplayName, labelOrigin, isOrganization, showDisconnect, onDisconnect, error, onReconnect }: { name: string; thumbnail?: string; storedDisplayName?: string; labelOrigin?: 'stored' | 'provider_id'; isOrganization: boolean; showDisconnect?: boolean; onDisconnect?: () => void; error?: boolean; onReconnect?: () => void }): ReactNode {
  const { t } = useI18n();
  return <div className="relative"><AccountCard type="linkedin" name={name} thumbnail={thumbnail} storedDisplayName={storedDisplayName} labelOrigin={labelOrigin} showDisconnect={showDisconnect} onDisconnect={onDisconnect} error={error} onReconnect={onReconnect} /><span className="absolute top-2 right-2 rounded border border-info/30 bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">{t(isOrganization ? 'accounts.pageBadge' : 'accounts.memberBadge')}</span></div>;
}


