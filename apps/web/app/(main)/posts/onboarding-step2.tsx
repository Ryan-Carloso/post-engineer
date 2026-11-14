'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProviderIcon } from '@/components/provider-icon';
import { ERROR_CODES } from '@/lib/error-codes';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { useOAuthFlow } from '@/lib/oauth/oauth-flow';
import {
  isOAuthProvider,
  isSocialProvider,
  type OAuthProvider,
  type SocialProvider,
} from '@/lib/providers/registry';
import type { AccountSyncStatus } from '@/lib/types';
import { useOnboardingWizardStore } from '@/lib/onboarding-wizard';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { useSocialAccountsQuery } from '@/lib/social-accounts-queries';
import { INPUT_CLASS } from '@/lib/ui';

//---------------
// Onboarding wizard step 2 — inline connect (issue #578, refs #573).
// The old step 2 linked every provider to /accounts, which unmounted
// this dialog (it only renders on /posts) and left the user to find
// their way back through the saved-step resume. This step never
// navigates: tapping a row swaps the dialog to that provider's real
// connect UI, and the OAuth flows open a popup (lib/oauth/popup.ts),
// so the page — and the wizard — stay mounted through the whole
// connect. The saved-step resume in lib/onboarding-wizard.ts stays as
// the safety net for a detour; dismiss-on-close is unchanged.
//---------------

// Display order is the approved mockup order, not SOCIAL_PROVIDERS
// order (Fanvue before 3Speak/Rumble). Brand names are literals: the
// same in both locales.
const STEP2_PROVIDERS = [
  'youtube',
  'instagram',
  'bluesky',
  'linkedin',
  'threads',
  'facebook',
  'pinterest',
  'fanvue',
  '3speak',
  'rumble',
] as const satisfies readonly SocialProvider[];

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  fanvue: 'Fanvue',
  '3speak': '3Speak',
  rumble: 'Rumble',
};

const PROVIDER_DESCRIPTIONS: Record<SocialProvider, TranslationKey> = {
  youtube: 'accounts.youtubeDescription',
  instagram: 'accounts.instagramDescription',
  bluesky: 'accounts.blueskyDescription',
  linkedin: 'accounts.linkedinDescription',
  threads: 'accounts.threadsDescription',
  facebook: 'accounts.facebookDescription',
  pinterest: 'accounts.pinterestDescription',
  fanvue: 'accounts.fanvueDescription',
  '3speak': 'accounts.threespeakDescription',
  rumble: 'accounts.rumbleDescription',
};

//---------------
// ONBOARDING_OAUTH_CONFIG — the /accounts OAuth configs, by value.
// The per-provider hooks (lib/oauth/*-handler.ts) are the same
// useOAuthFlow call with the same config; the sync test in
// __tests__/onboarding-step2-oauth-config.test.tsx pins the copy, so a
// start URL or callback message that changes in a handler breaks there
// instead of silently connecting the wrong provider.
//---------------

export const ONBOARDING_OAUTH_CONFIG: Record<
  OAuthProvider,
  { startUrl: string; popupTitle: string; successType: string; errorType: string; queryKey: readonly string[] }
> = {
  youtube: {
    startUrl: '/api/google-oauth/start',
    popupTitle: 'YouTube OAuth',
    successType: 'youtube-oauth-success',
    errorType: 'youtube-oauth-error',
    queryKey: ['social-accounts'],
  },
  instagram: {
    startUrl: '/api/instagram-auth/start',
    popupTitle: 'Instagram OAuth',
    successType: 'instagram-oauth-success',
    errorType: 'instagram-oauth-error',
    queryKey: ['social-accounts'],
  },
  linkedin: {
    startUrl: '/api/linkedin-auth/start',
    popupTitle: 'LinkedIn OAuth',
    successType: 'linkedin-oauth-success',
    errorType: 'linkedin-oauth-error',
    queryKey: ['social-accounts'],
  },
  threads: {
    startUrl: '/api/threads-auth/start',
    popupTitle: 'Threads OAuth',
    successType: 'threads-oauth-success',
    errorType: 'threads-oauth-error',
    queryKey: ['social-accounts'],
  },
  facebook: {
    startUrl: '/api/facebook-auth/start',
    popupTitle: 'Facebook OAuth',
    successType: 'facebook-oauth-success',
    errorType: 'facebook-oauth-error',
    queryKey: ['social-accounts'],
  },
  pinterest: {
    startUrl: '/api/pinterest-auth/start',
    popupTitle: 'Pinterest OAuth',
    successType: 'pinterest-oauth-success',
    errorType: 'pinterest-oauth-error',
    queryKey: ['social-accounts'],
  },
  fanvue: {
    startUrl: '/api/fanvue-auth/start',
    popupTitle: 'Fanvue OAuth',
    successType: 'fanvue-oauth-success',
    errorType: 'fanvue-oauth-error',
    queryKey: ['social-accounts'],
  },
};

//---------------
// Credential providers have no OAuth: Bluesky takes a handle plus an
// app password, 3Speak a Hive username plus its posting key, Rumble a
// channel id plus a manual access token. The endpoints, field names,
// and error mapping are the same as the /accounts sections
// (credential-accounts-sections.tsx, threespeak-accounts-section.tsx);
// only the form renders inline here instead of in a KeyConnectDialog.
//---------------

type CredentialProvider = Exclude<SocialProvider, OAuthProvider>;

interface CredentialConnectConfig {
  endpoint: string;
  handleField: string;
  passwordField: string;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  handleLabelKey: TranslationKey;
  passwordLabelKey: TranslationKey;
  submitLabelKey: TranslationKey;
  securityHintKey: TranslationKey;
  errorKey: TranslationKey;
  credentialRejectedKey?: TranslationKey;
}

const CREDENTIAL_CONFIG: Record<CredentialProvider, CredentialConnectConfig> = {
  bluesky: {
    endpoint: '/api/bluesky-connect',
    handleField: 'handle',
    passwordField: 'appPassword',
    titleKey: 'accounts.blueskyConnectTitle',
    hintKey: 'accounts.blueskyConnectHint',
    handleLabelKey: 'accounts.blueskyHandleLabel',
    passwordLabelKey: 'accounts.blueskyPasswordLabel',
    submitLabelKey: 'accounts.blueskyConnect',
    securityHintKey: 'accounts.blueskySecurityHint',
    errorKey: 'accounts.blueskyConnectError',
  },
  '3speak': {
    endpoint: '/api/threespeak-connect',
    handleField: 'username',
    passwordField: 'postingKey',
    titleKey: 'accounts.threespeakConnectTitle',
    hintKey: 'accounts.threespeakConnectHint',
    handleLabelKey: 'accounts.threespeakHandleLabel',
    passwordLabelKey: 'accounts.threespeakPasswordLabel',
    submitLabelKey: 'accounts.threespeakConnect',
    securityHintKey: 'accounts.threespeakSecurityHint',
    errorKey: 'accounts.threespeakConnectError',
    credentialRejectedKey: 'accounts.threespeakCredentialRejected',
  },
  rumble: {
    endpoint: '/api/rumble-connect',
    handleField: 'channelId',
    passwordField: 'accessToken',
    titleKey: 'accounts.rumbleConnectTitle',
    hintKey: 'accounts.rumbleConnectHint',
    handleLabelKey: 'accounts.rumbleChannelLabel',
    passwordLabelKey: 'accounts.rumbleTokenLabel',
    submitLabelKey: 'accounts.rumbleConnect',
    securityHintKey: 'accounts.rumbleSecurityHint',
    errorKey: 'accounts.rumbleConnectError',
  },
};

// An account with sync status 'error' has a dead credential (revoked
// token, undecryptable secret) — the /accounts page flags it as invalid
// instead of healthy, so the wizard must not badge it Connected either.
// The field is optional: payloads without it read as healthy.
function connectedProviders(accounts: Array<{ provider: string; status?: AccountSyncStatus }>): Set<SocialProvider> {
  const connected = new Set<SocialProvider>();
  for (const account of accounts) {
    if (isSocialProvider(account.provider) && account.status !== 'error') connected.add(account.provider);
  }
  return connected;
}

export function WizardStepTwo() {
  const { t } = useI18n();
  const next = useOnboardingWizardStore((s) => s.next);
  const [selected, setSelected] = useState<SocialProvider | null>(null);
  // One shared ['social-accounts'] query — the same single GET
  // /api/account the /accounts page uses — so the badges read the
  // live connected state with no extra fetch.
  const accountsQuery = useSocialAccountsQuery();
  const connected = connectedProviders(accountsQuery.data?.accounts ?? []);

  if (selected !== null) {
    return <WizardStepTwoConnect provider={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('onboarding.step2Title')}</DialogTitle>
        <DialogDescription>{t('onboarding.step2Body')}</DialogDescription>
      </DialogHeader>
      {accountsQuery.isError ? (
        <p className="text-sm text-destructive">{t('accounts.loadError')}</p>
      ) : null}
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto pr-1">
        {STEP2_PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            data-testid={`onboarding-provider-${provider}`}
            onClick={() => setSelected(provider)}
            className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-sunken"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <ProviderIcon provider={provider} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">{PROVIDER_LABELS[provider]}</span>
              <span className="block text-xs text-muted-text">
                {t(isOAuthProvider(provider) ? 'onboarding.step2OAuthHint' : 'onboarding.step2KeyHint')}
              </span>
            </span>
            {connected.has(provider) ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                <Check className="size-3.5" aria-hidden />
                {t('onboarding.connected')}
              </span>
            ) : (
              <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
            )}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={next}>
          {t('onboarding.skip')}
        </Button>
      </div>
    </>
  );
}

function WizardStepTwoConnect({ provider, onBack }: { provider: SocialProvider; onBack: () => void }) {
  const { t } = useI18n();
  const next = useOnboardingWizardStore((s) => s.next);
  const accountsQuery = useSocialAccountsQuery();
  // Same dead-credential guard as connectedProviders: an 'error' account
  // must not show Connected or Continue here either.
  const connected = (accountsQuery.data?.accounts ?? []).some(
    (account) => account.provider === provider && account.status !== 'error',
  );

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={onBack}
            aria-label={t('onboarding.backToProviders')}
            data-testid="onboarding-provider-back"
          >
            <ArrowLeft aria-hidden />
          </Button>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ProviderIcon provider={provider} />
          </span>
          <DialogTitle>{PROVIDER_LABELS[provider]}</DialogTitle>
        </div>
        <DialogDescription>{t(PROVIDER_DESCRIPTIONS[provider])}</DialogDescription>
      </DialogHeader>
      {accountsQuery.isError ? (
        <p className="text-sm text-destructive">{t('accounts.loadError')}</p>
      ) : null}
      {isOAuthProvider(provider) ? (
        <OAuthConnectView provider={provider} connected={connected} />
      ) : (
        <CredentialConnectView provider={provider} connected={connected} />
      )}
      {connected ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={next}>
            {t('onboarding.continue')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function OAuthConnectView({ provider, connected }: { provider: OAuthProvider; connected: boolean }) {
  const { t } = useI18n();
  const oauth = useOAuthFlow(ONBOARDING_OAUTH_CONFIG[provider]);
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        size="sm"
        onClick={() => void oauth.startOAuth()}
        disabled={oauth.isLoading}
      >
        {t(connected ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      </Button>
      {oauth.error ? <p className="text-sm text-destructive">{oauth.error}</p> : null}
      {connected ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="size-4" aria-hidden />
          {t('onboarding.connected')}
        </p>
      ) : null}
    </div>
  );
}

//---------------
// useCredentialConnect — the /accounts credential POST as a hook: the
// same endpoint, field names, and error mapping as the provider's
// section, with the shared accounts query invalidated on success so
// the Connected badge appears without a page reload.
//---------------

function useCredentialConnect(provider: CredentialProvider) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const config = CREDENTIAL_CONFIG[provider];
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !appPassword.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append(config.handleField, handle.trim());
      formData.append(config.passwordField, appPassword);
      const response = await fetch(config.endpoint, { method: 'POST', body: formData });
      if (!response.ok) {
        // 401 here means a dead hub session (a rejected credential is
        // 422), so it triggers the host-wide session-expiry redirect.
        notifyIfSessionExpired(response);
        if (config.credentialRejectedKey) {
          // A rejected credential is 422 THREESPEAK_CREDENTIAL_REJECTED:
          // name it, so the user knows the username/key pair is what
          // 3Speak refused.
          const body: unknown = await response.json().catch(() => null);
          const code = (body as { code?: unknown } | null)?.code;
          setError(
            t(
              code === ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED
                ? config.credentialRejectedKey
                : config.errorKey,
            ),
          );
        } else {
          setError(t(config.errorKey));
        }
        setAppPassword('');
        return;
      }
      setHandle('');
      setAppPassword('');
      await queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    } catch {
      setError(t(config.errorKey));
      setAppPassword('');
    } finally {
      setPending(false);
    }
  };

  return { config, handle, appPassword, pending, error, setHandle, setAppPassword, connect };
}

function CredentialConnectView({ provider, connected }: { provider: CredentialProvider; connected: boolean }) {
  const { t } = useI18n();
  const { config, handle, appPassword, pending, error, setHandle, setAppPassword, connect } =
    useCredentialConnect(provider);
  return (
    <div className="grid gap-4">
      <p className="text-sm leading-5 text-muted-text">{t(config.hintKey)}</p>
      <label className="text-sm font-medium text-ink-soft">
        {t(config.handleLabelKey)}
        <input
          data-testid={`${provider}-handle-input`}
          type="text"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </label>
      <label className="text-sm font-medium text-ink-soft">
        {t(config.passwordLabelKey)}
        <input
          data-testid={`${provider}-password-input`}
          type="password"
          value={appPassword}
          onChange={(event) => setAppPassword(event.target.value)}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </label>
      <Button
        type="button"
        data-testid={`${provider}-connect-button`}
        onClick={() => void connect()}
        disabled={!handle.trim() || !appPassword.trim() || pending}
        className="w-full"
      >
        {t(config.submitLabelKey)}
      </Button>
      {error ? (
        <p data-testid={`${provider}-connect-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {connected ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="size-4" aria-hidden />
          {t('onboarding.connected')}
        </p>
      ) : null}
      <p className="text-xs leading-4 text-faint">{t(config.securityHintKey)}</p>
    </div>
  );
}
