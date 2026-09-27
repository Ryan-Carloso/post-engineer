'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import SocialAccountsSection from '@/components/ui/social-accounts-section';
import { BlueskyConnectDialog } from '@/components/ui/social-accounts-section';
import {
  useBlueskyAccountsQuery,
  useDisconnectAccountMutation,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useYouTubeAccountsQuery,
  type DisconnectAccountResult,
} from '@/lib/api';
import { useUploadStore } from '@/lib/store';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useI18n } from '@/lib/i18n/provider';
import { AccountsIcon, GoogleIcon, InstagramIcon } from '@/lib/ui';

export default function AccountsPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <AccountsHeader />
      <main className="flex flex-col gap-5 lg:gap-6">
        <YoutubeAccountsSection />
        <InstagramAccountsSection />
        <BlueskyAccountsSection />
        <LinkedinAccountsSection />
      </main>
    </div>
  );
}

//---------------
// Cabeçalho da tela de contas.
//---------------

function AccountsHeader(): React.ReactElement {
  const { t } = useI18n();
  return (
    <header className="flex items-center gap-4 py-1 lg:py-2">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
        <AccountsIcon />
      </span>
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.035em] text-[#101728]">{t('accounts.title')}</h1>
        <p className="mt-0.5 text-sm text-[#718096] lg:text-base">{t('accounts.subtitle')}</p>
      </div>
    </header>
  );
}

//---------------
// Contas YouTube: uma query e um fluxo OAuth.
//---------------

function YoutubeAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useYouTubeAccountsQuery();
  const oauth = useYouTubeOAuth();
  const disconnect = useDisconnectAccountMutation('youtube');
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.youtube);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  const onDisconnectAccount = (providerAccountId: string): void => {
    setDisconnectError(null);
    void handleDisconnect(t, disconnect, providerAccountId, setDisconnectError);
  };
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-red-50 text-red-600"><GoogleIcon /></BrandIcon>}
      label={t('accounts.youtubeLabel')}
      description={t('accounts.youtubeDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="youtube" name={account.channelName} email={account.email} thumbnail={account.thumbnail} customUrl={account.customUrl} onSelect={() => toggle('youtube', account.channelId)} selected={selectedIds.includes(account.channelId)} showDisconnect onDisconnect={() => onDisconnectAccount(account.channelId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
    />
  );
}

//---------------
// Contas Instagram: uma query e um fluxo OAuth.
//---------------

function InstagramAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useInstagramAccountsQuery();
  const oauth = useInstagramOAuth();
  const disconnect = useDisconnectAccountMutation('instagram');
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const selectedIds = useUploadStore((state) => state.selectedAccountIds.instagram);
  const toggle = useUploadStore((state) => state.toggleSelectedAccount);
  const accounts = query.data?.accounts ?? [];
  const onDisconnectAccount = (providerAccountId: string): void => {
    setDisconnectError(null);
    void handleDisconnect(t, disconnect, providerAccountId, setDisconnectError);
  };
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-pink-50 text-pink-600"><InstagramIcon /></BrandIcon>}
      label={t('accounts.instagramLabel')}
      description={t('accounts.instagramDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="instagram" name={`@${account.username}`} thumbnail={account.profilePictureUrl} onSelect={() => toggle('instagram', account.igUserId)} selected={selectedIds.includes(account.igUserId)} showDisconnect onDisconnect={() => onDisconnectAccount(account.igUserId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
    />
  );
}

//---------------
// Contas Bluesky: uma query e um dialog controlado pela página.
//---------------

function BlueskyAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useBlueskyAccountsQuery();
  const disconnect = useDisconnectAccountMutation('bluesky');
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !appPassword.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('handle', handle.trim());
      formData.append('appPassword', appPassword);
      const response = await fetch('/api/bluesky-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        setError(t('accounts.blueskyConnectError'));
        setAppPassword('');
        return;
      }
      setOpen(false);
      setHandle('');
      setAppPassword('');
      void query.refetch();
    } catch {
      setError(t('accounts.blueskyConnectError'));
      setAppPassword('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-sky-50 text-sky-600"><BlueskyIcon /></BrandIcon>}
      label={t('accounts.blueskyLabel')}
      description={t('accounts.blueskyDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="bluesky" name={account.handle} handle={account.handle} showDisconnect onDisconnect={() => { setDisconnectError(null); void handleDisconnect(t, disconnect, account.did, setDisconnectError); }} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={null}
      disconnectError={disconnectError}
      connectDisabled={false}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => setOpen(true)}
      onRetry={() => void query.refetch()}
      dialog={open ? <BlueskyConnectDialog title={t('accounts.blueskyConnectTitle')} hint={t('accounts.blueskyConnectHint')} handleLabel={t('accounts.blueskyHandleLabel')} passwordLabel={t('accounts.blueskyPasswordLabel')} submitLabel={t('accounts.blueskyConnect')} securityHint={t('accounts.blueskySecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
    />
  );
}

//---------------
// Contas LinkedIn: uma query e um fluxo OAuth.
//---------------

function LinkedinAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useLinkedinAccountsQuery();
  const oauth = useLinkedInOAuth();
  const disconnect = useDisconnectAccountMutation('linkedin');
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-blue-50 text-blue-700"><LinkedinIcon /></BrandIcon>}
      label={t('accounts.linkedinLabel')}
      description={t('accounts.linkedinDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <LinkedinAccountCard key={account.recordId} name={account.accountName || account.providerAccountId} isOrganization={account.providerAccountId.startsWith('urn:li:organization:')} showDisconnect onDisconnect={() => { setDisconnectError(null); void handleDisconnect(t, disconnect, account.providerAccountId, setDisconnectError); }} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={oauth.error}
      disconnectError={disconnectError}
      connectDisabled={oauth.isLoading}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => void oauth.startOAuth()}
      onRetry={() => void query.refetch()}
    />
  );
}

//---------------
// Bloco visual de marca e contador traduzido.
//---------------

function BrandIcon({ className, children }: { className: string; children: ReactNode }): ReactNode {
  return <span className={`flex size-9 items-center justify-center rounded-lg ${className} [&>svg]:size-5`}>{children}</span>;
}

function connectedLabel(t: ReturnType<typeof useI18n>['t'], count: number): string {
  return t(count === 1 ? 'accounts.accountConnected' : 'accounts.accountsConnected', { count });
}

//---------------
// handleDisconnect — confirmação antes de desconectar (igual ao delete de persona).
// Falhas (exceção ou success: false) são reportadas via onError em vez de
// engolidas em silêncio.
//---------------

async function handleDisconnect(
  t: ReturnType<typeof useI18n>['t'],
  disconnect: { mutateAsync: (input: { providerAccountId: string }) => Promise<DisconnectAccountResult> },
  providerAccountId: string,
  onError: (message: string) => void,
): Promise<void> {
  if (!window.confirm(t('accounts.disconnectQuestion'))) return;
  try {
    const result = await disconnect.mutateAsync({ providerAccountId });
    if (!result.success) onError(t('accounts.disconnectError'));
  } catch {
    onError(t('accounts.disconnectError'));
  }
}

//---------------
// Card LinkedIn com distinção entre perfil e página.
//---------------

function LinkedinAccountCard({ name, isOrganization, showDisconnect, onDisconnect }: { name: string; isOrganization: boolean; showDisconnect?: boolean; onDisconnect?: () => void }): ReactNode {
  const { t } = useI18n();
  return <div className="relative"><AccountCard type="linkedin" name={name} showDisconnect={showDisconnect} onDisconnect={onDisconnect} /><span className="absolute top-2 right-2 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{t(isOrganization ? 'accounts.pageBadge' : 'accounts.memberBadge')}</span></div>;
}

function BlueskyIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M12 10.8c-1.087-2.114-4.046-6.033-6.798-7.978C2.566 1.01.562 1.098.064 1.855c-.499.757.06 3.708 1.277 5.196.76.93 1.883 2.022 3.19 2.904-1.538-.24-3.02.052-3.585.754-.79.982.294 3.029 2.424 4.573 1.187.86 2.662 1.5 4.082 1.788-1.555.288-3.04 1.017-3.575 2.015-.72 1.343.682 2.72 3.125 3.076 2.1.307 4.653-.355 5.998-1.71 1.345 1.355 3.898 2.017 5.998 1.71 2.443-.356 3.845-1.733 3.125-3.076-.535-.998-2.02-1.727-3.575-2.015 1.42-.288 2.895-.928 4.082-1.788 2.13-1.544 3.214-3.591 2.424-4.573-.565-.702-2.047-.994-3.585-.754 1.307-.882 2.43-1.974 3.19-2.904 1.217-1.488 1.776-4.439 1.277-5.196-.498-.757-2.502-.845-5.138.967C16.046 4.767 13.087 8.686 12 10.8z" /></svg>;
}

function LinkedinIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>;
}
