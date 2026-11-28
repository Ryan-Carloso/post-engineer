'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import { CheckIcon } from '@/lib/ui';

export default function ApiKeyCreatedCard({
  name,
  secret,
  onCreateAnother,
}: {
  name: string;
  secret: string;
  onCreateAnother: () => void;
}): ReactNode {
  const { t } = useI18n();
  const { copied, copy } = useCopyText();

  return (
    <div
      data-testid="api-key-created-banner"
      className="rounded-xl border border-success/30 bg-success-soft p-4 text-success"
    >
      <div className="mb-2 flex items-center gap-2">
        <CheckIcon />
        <span className="font-bold text-success">{t('apiKeys.keyCreatedTitle')}</span>
        <span className="text-xs font-semibold text-success">({name})</span>
      </div>
      <p className="mb-3 text-xs text-success">{t('apiKeys.warningCopyOnce')}</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          data-testid="raw-api-key-value"
          value={secret}
          className="w-full rounded-lg border border-success/30 bg-card px-3 py-2 font-mono text-sm text-ink select-all"
        />
        <Button
          type="button"
          data-testid="copy-api-key-btn"
          onClick={() => copy(secret)}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          {copied ? t('apiKeys.copied') : t('apiKeys.copyKey')}
        </Button>
      </div>
      <p className="mt-3 text-xs text-success">{t('apiKeys.keyCreatedNext')}</p>
      <Button
        type="button"
        data-testid="create-another-key-btn"
        variant="ghost"
        onClick={onCreateAnother}
        className="mt-2 h-auto px-2 py-1 text-xs font-semibold text-success hover:bg-success/10"
      >
        {t('apiKeys.createAnother')}
      </Button>
    </div>
  );
}
