'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import DisconnectAccountDialog from '@/components/ui/disconnect-account-dialog';
import SocialAccountsSection from '@/components/ui/social-accounts-section';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import {
  useBlueskyAccountsQuery,
  useThreespeakAccountsQuery,
  useDisconnectAccountMutation,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useThreadsAccountsQuery,
  useFacebookAccountsQuery,
  useYouTubeAccountsQuery,
  type DisconnectableProvider,
  type DisconnectAccountResult,
} from '@/lib/api';
import { useUploadStore } from '@/lib/store';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';
import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';
import { ProviderIcon } from '@/components/provider-icon';
import { useAccountListErrorTelemetry, reportAccountDisconnectFailed } from '@/lib/account-card-telemetry';
import { ERROR_CODES } from '@/lib/error-codes';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
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
        <ThreadsAccountsSection />
        <FacebookAccountsSection />
        <ThreespeakAccountsSection />
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
// Bluesky accounts: one query and a dialog owned by the page.
//---------------

function BlueskyAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useBlueskyAccountsQuery();
  const flow = useDisconnectFlow('bluesky');
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('bluesky', query.error?.message ?? null);

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
        // 401 here means a dead hub session (a rejected Bluesky credential
        // is 422), so it triggers the host-wide session-expiry redirect.
        notifyIfSessionExpired(response);
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
      icon={<BrandIcon className="bg-info-soft text-info"><BlueskyIcon /></BrandIcon>}
      label={t('accounts.blueskyLabel')}
      description={t('accounts.blueskyDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="bluesky" name={account.displayName ?? account.handle} thumbnail={account.avatar} showDisconnect onDisconnect={() => flow.onDisconnect(account.did, account.displayName ?? account.handle)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={null}
      disconnectError={flow.disconnectError}
      connectDisabled={false}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => setOpen(true)}
      onRetry={() => void query.refetch()}
      dialog={
        <>
          {flow.dialog}
          {open ? <KeyConnectDialog title={t('accounts.blueskyConnectTitle')} hint={t('accounts.blueskyConnectHint')} handleLabel={t('accounts.blueskyHandleLabel')} passwordLabel={t('accounts.blueskyPasswordLabel')} submitLabel={t('accounts.blueskyConnect')} securityHint={t('accounts.blueskySecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
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
// Brand mark and the translated connected-count.
//---------------

function BrandIcon({ className, children }: { className: string; children: ReactNode }): ReactNode {
  return <span className={`flex size-9 items-center justify-center rounded-lg ${className} [&>svg]:size-5`}>{children}</span>;
}

function connectedLabel(t: ReturnType<typeof useI18n>['t'], count: number): string {
  return t(count === 1 ? 'accounts.accountConnected' : 'accounts.accountsConnected', { count });
}

//---------------
// useDisconnectFlow — one dialog-backed disconnect flow per provider
// section. The trash button on the card opens the confirmation dialog;
// confirming runs the disconnect, and a throw or success:false is shown
// in the section and sent to PostHog.
//---------------

interface PendingDisconnect {
  providerAccountId: string;
  label: string;
}

function useDisconnectFlow(provider: DisconnectableProvider): {
  disconnectError: string | null;
  onDisconnect: (providerAccountId: string, label: string) => void;
  dialog: ReactNode;
} {
  const { t } = useI18n();
  const disconnect = useDisconnectAccountMutation(provider);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDisconnect | null>(null);

  // Opening the dialog clears a previous section error, so the fresh
  // attempt starts from a clean panel.
  const onDisconnect = (providerAccountId: string, label: string): void => {
    setDisconnectError(null);
    setPending({ providerAccountId, label });
  };

  const confirm = (): void => {
    if (pending === null || disconnect.isPending) return;
    void handleDisconnect(t, disconnect, provider, pending.providerAccountId, setDisconnectError)
      .finally(() => setPending(null));
  };

  const dialog = (
    <DisconnectAccountDialog
      open={pending !== null}
      onClose={() => { if (!disconnect.isPending) setPending(null); }}
      onConfirm={confirm}
      pending={disconnect.isPending}
      accountName={pending?.label ?? ''}
      title={t('accounts.disconnectQuestion')}
      body={t('accounts.disconnectBody')}
      cancelLabel={t('accounts.disconnectCancel')}
      confirmLabel={t('accounts.disconnectConfirm')}
    />
  );

  return { disconnectError, onDisconnect, dialog };
}

//---------------
// handleDisconnect — runs the disconnect for one account. A throw or
// success:false is shown in the section and sent to PostHog.
//---------------

async function handleDisconnect(
  t: ReturnType<typeof useI18n>['t'],
  disconnect: { mutateAsync: (input: { providerAccountId: string }) => Promise<DisconnectAccountResult> },
  provider: DisconnectableProvider,
  providerAccountId: string,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const result = await disconnect.mutateAsync({ providerAccountId });
    if (!result.success) {
      reportAccountDisconnectFailed(provider, 'rejected');
      onError(t('accounts.disconnectError'));
    }
  } catch {
    reportAccountDisconnectFailed(provider, 'threw');
    onError(t('accounts.disconnectError'));
  }
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
// 3Speak accounts: one query and a key dialog owned by the page — same
// shape as Bluesky (no OAuth: a Hive username plus its posting key).
// The route validates the key against Studio before storing it, so a
// rejected key is 422, not 401; only a dead hub session is 401 here.
//---------------

function ThreespeakAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useThreespeakAccountsQuery();
  const flow = useDisconnectFlow('3speak');
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  useAccountListErrorTelemetry('3speak', query.error?.message ?? null);

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !appPassword.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('username', handle.trim());
      formData.append('postingKey', appPassword);
      const response = await fetch('/api/threespeak-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        // 401 here means a dead hub session (a rejected Hive posting key
        // is 422), so it triggers the host-wide session-expiry redirect.
        notifyIfSessionExpired(response);
        // The route distinguishes a rejected credential (422
        // THREESPEAK_CREDENTIAL_REJECTED) from other failures: name it so
        // the user knows the username/key pair is what 3Speak refused.
        // notifyIfSessionExpired reads only the status, so the body is
        // still unread here.
        const body: unknown = await response.json().catch(() => null);
        const code = (body as { code?: unknown } | null)?.code;
        setError(
          code === ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED
            ? t('accounts.threespeakCredentialRejected')
            : t('accounts.threespeakConnectError'),
        );
        setAppPassword('');
        return;
      }
      setOpen(false);
      setHandle('');
      setAppPassword('');
      void query.refetch();
    } catch {
      setError(t('accounts.threespeakConnectError'));
      setAppPassword('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-muted"><ProviderIcon provider="3speak" /></BrandIcon>}
      label={t('accounts.threespeakLabel')}
      description={t('accounts.threespeakDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="3speak" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={null}
      disconnectError={flow.disconnectError}
      connectDisabled={false}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => setOpen(true)}
      onRetry={() => void query.refetch()}
      dialog={
        <>
          {flow.dialog}
          {open ? <KeyConnectDialog idPrefix="threespeak" title={t('accounts.threespeakConnectTitle')} hint={t('accounts.threespeakConnectHint')} handleLabel={t('accounts.threespeakHandleLabel')} passwordLabel={t('accounts.threespeakPasswordLabel')} submitLabel={t('accounts.threespeakConnect')} securityHint={t('accounts.threespeakSecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
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

function BlueskyIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M12 10.8c-1.087-2.114-4.046-6.033-6.798-7.978C2.566 1.01.562 1.098.064 1.855c-.499.757.06 3.708 1.277 5.196.76.93 1.883 2.022 3.19 2.904-1.538-.24-3.02.052-3.585.754-.79.982.294 3.029 2.424 4.573 1.187.86 2.662 1.5 4.082 1.788-1.555.288-3.04 1.017-3.575 2.015-.72 1.343.682 2.72 3.125 3.076 2.1.307 4.653-.355 5.998-1.71 1.345 1.355 3.898 2.017 5.998 1.71 2.443-.356 3.845-1.733 3.125-3.076-.535-.998-2.02-1.727-3.575-2.015 1.42-.288 2.895-.928 4.082-1.788 2.13-1.544 3.214-3.591 2.424-4.573-.565-.702-2.047-.994-3.585-.754 1.307-.882 2.43-1.974 3.19-2.904 1.217-1.488 1.776-4.439 1.277-5.196-.498-.757-2.502-.845-5.138.967C16.046 4.767 13.087 8.686 12 10.8z" /></svg>;
}

function LinkedinIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>;
}
