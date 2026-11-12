'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import DisconnectAccountDialog from '@/components/ui/disconnect-account-dialog';
import {
  useDisconnectAccountMutation,
  type DisconnectableProvider,
  type DisconnectAccountResult,
} from '@/lib/api';
import { reportAccountDisconnectFailed } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// Brand mark and the translated connected-count.
//---------------

export function BrandIcon({ className, children }: { className: string; children: ReactNode }): ReactNode {
  return <span className={`flex size-9 items-center justify-center rounded-lg ${className} [&>svg]:size-5`}>{children}</span>;
}

export function connectedLabel(t: ReturnType<typeof useI18n>['t'], count: number): string {
  return t(count === 1 ? 'accounts.accountConnected' : 'accounts.accountsConnected', { count });
}

export function errorLabel(t: ReturnType<typeof useI18n>['t'], count: number): string {
  return t(count === 1 ? 'accounts.accountWithIssue' : 'accounts.accountsWithIssues', { count });
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

export function useDisconnectFlow(provider: DisconnectableProvider): {
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
