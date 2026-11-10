'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

export function CalendarUnavailableFrame({ children }: { children: ReactNode }) {
  return (
    <div
      data-calendar-unavailable-frame
      data-calendar-load-error
      className="flex w-full flex-col items-center justify-center px-4 py-10 text-center sm:px-6"
    >
      {children}
    </div>
  );
}

export function CalendarLoadErrorEmptyState({
  messageKey,
  onRetry,
}: {
  messageKey: TranslationKey;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-calendar-load-error-empty
      className="flex w-full max-w-lg flex-col items-center gap-3"
    >
      <span
        data-calendar-load-error-icon
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning"
      >
        <TriangleAlert className="size-6" strokeWidth={2.25} aria-hidden />
      </span>
      <p className="text-sm font-semibold leading-snug text-primary">{t(messageKey)}</p>
      <Button
        type="button"
        variant="default"
        data-load-error-retry
        className="min-h-10 px-6 font-semibold"
        onClick={onRetry}
      >
        {t('posts.loadErrorRetry')}
      </Button>
    </div>
  );
}
