'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRefreshAccountProfilesMutation } from '@/lib/account-profile-refresh';
import { useI18n } from '@/lib/i18n/provider';
import { AccountsIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';

type RefreshStatus = 'idle' | 'pending' | 'done' | 'error';

function refreshStatus(mutation: ReturnType<typeof useRefreshAccountProfilesMutation>): RefreshStatus {
  if (mutation.isPending) return 'pending';
  if (mutation.data === undefined) return 'idle';
  return mutation.data.success ? 'done' : 'error';
}

export function AccountsHeader(): React.ReactElement {
  const { t } = useI18n();
  const mutation = useRefreshAccountProfilesMutation();
  const status = refreshStatus(mutation);
  return (
    <header className="flex flex-wrap items-center gap-4 py-1 lg:py-2">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
        <AccountsIcon />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-[-0.035em] text-ink">{t('accounts.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-text lg:text-base">{t('accounts.subtitle')}</p>
      </div>
      <div className="flex w-full flex-col items-start gap-1 sm:w-auto sm:items-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={status === 'pending'}
          data-testid="accounts-refresh-profiles"
        >
          <RefreshCw aria-hidden="true" className={cn(status === 'pending' && 'animate-spin')} />
          {t(status === 'pending' ? 'accounts.refreshingProfiles' : 'accounts.refreshProfiles')}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className={cn('text-xs empty:hidden', status === 'error' ? 'text-destructive' : 'text-muted-text')}
        >
          {status === 'done' && t('accounts.refreshProfilesDone')}
          {status === 'error' && t('accounts.refreshProfilesError')}
        </p>
      </div>
    </header>
  );
}
