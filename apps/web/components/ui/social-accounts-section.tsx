import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/lib/ui';

export interface SocialAccountsSectionProps {
  icon: ReactNode;
  label: string;
  description: string;
  connectedLabel: string;
  count: number;
  accounts: ReactNode[];
  isLoading: boolean;
  loadError: string | null;
  connectLabel: string;
  connectError: string | null;
  disconnectError?: string | null;
  connectDisabled: boolean;
  retryLabel: string;
  onConnect: () => void;
  onRetry: () => void;
  dialog?: ReactNode;
}

export default function SocialAccountsSection({
  icon,
  label,
  description,
  connectedLabel,
  count,
  accounts,
  isLoading,
  loadError,
  connectLabel,
  connectError,
  disconnectError,
  connectDisabled,
  retryLabel,
  onConnect,
  onRetry,
  dialog,
}: SocialAccountsSectionProps): ReactNode {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe5ec] bg-white shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="flex items-center justify-between gap-4 p-4 lg:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[#edf0f4] bg-white shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold tracking-tight text-[#101728]">{label}</h2>
              <span className="text-sm font-medium text-[#8a94a8]">({count})</span>
            </div>
            <p className="text-sm leading-5 text-[#718096]">{description}</p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 sm:flex">
          <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
          {connectedLabel}
        </span>
      </div>
      <div className="p-4 pt-0 lg:p-6 lg:pt-0">
        {isLoading ? (
          <SocialAccountsSkeleton />
        ) : loadError ? (
          <SocialAccountsLoadError message={loadError} retryLabel={retryLabel} onRetry={onRetry} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {accounts}
            <div className="flex min-h-20 flex-col items-start gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onConnect}
                disabled={connectDisabled}
                aria-label={connectLabel}
                className="size-full min-h-20 border-dashed text-[#52627a] hover:border-[#9aa9bb] hover:bg-[#fbfcfd]"
              >
                {connectDisabled ? <SpinnerIcon /> : null}
                {connectLabel}
              </Button>
              {connectError ? <p className="text-sm text-red-600">{connectError}</p> : null}
            </div>
          </div>
        )}
      </div>
      {disconnectError ? (
        <p data-testid="disconnect-error" className="px-4 pb-4 text-sm text-red-600 lg:px-6 lg:pb-6">
          {disconnectError}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}

export interface BlueskyConnectDialogProps {
  title: string;
  hint: string;
  handleLabel: string;
  passwordLabel: string;
  submitLabel: string;
  securityHint: string;
  closeLabel: string;
  handle: string;
  appPassword: string;
  error: string | null;
  pending: boolean;
  onHandleChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BlueskyConnectDialog({
  title,
  hint,
  handleLabel,
  passwordLabel,
  submitLabel,
  securityHint,
  closeLabel,
  handle,
  appPassword,
  error,
  pending,
  onHandleChange,
  onPasswordChange,
  onSubmit,
  onClose,
}: BlueskyConnectDialogProps): ReactNode {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101728]/45 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bluesky-dialog-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="bluesky-dialog-title" className="text-lg font-bold text-[#101728]">{title}</h2>
            <p className="mt-2 text-sm leading-5 text-[#718096]">{hint}</p>
          </div>
          <button type="button" aria-label={closeLabel} onClick={onClose} className="rounded-md px-2 py-1 text-xl text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800">×</button>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-neutral-700">
            {handleLabel}
            <input data-testid="bluesky-handle-input" type="text" value={handle} onChange={(event) => onHandleChange(event.target.value)} autoComplete="off" className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10" />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            {passwordLabel}
            <input data-testid="bluesky-password-input" type="password" value={appPassword} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="off" className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10" />
          </label>
          <Button type="button" data-testid="bluesky-connect-button" onClick={onSubmit} disabled={!handle.trim() || !appPassword.trim() || pending} className="w-full">
            {submitLabel}
          </Button>
          {error ? <p data-testid="bluesky-connect-error" className="text-sm text-red-600">{error}</p> : null}
          <p className="text-xs leading-4 text-neutral-400">{securityHint}</p>
        </div>
      </div>
    </div>
  );
}

function SocialAccountsSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-live="polite" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => <div key={item} className="rounded-xl border border-neutral-200 bg-white p-4"><div className="skeleton-shimmer h-12 rounded-full" /></div>)}
    </div>
  );
}

function SocialAccountsLoadError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }): ReactNode {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">{retryLabel}</button>
    </div>
  );
}
