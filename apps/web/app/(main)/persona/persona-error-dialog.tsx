'use client';

import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { AlertIcon } from '@/lib/ui';

//---------------
// PersonaErrorDialog — create/update error in a modal (not a box at the page bottom), so the message is not lost.
//---------------
export const PersonaErrorDialog = () => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  if (!result || result.success) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="persona-error-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <div className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <AlertIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="persona-error-dialog-title" className="text-lg font-semibold text-ink">
              {t('persona.failed')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-text">{result.error}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => usePersonaStore.getState().setResult(null)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-accent-hover"
          >
            {t('persona.tryAgain')}
          </button>
        </div>
      </div>
    </div>
  );
};
