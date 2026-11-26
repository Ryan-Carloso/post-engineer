'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { PostPromptFacts } from '@/lib/slot-detail';

export const PromptSection = ({ prompt }: { prompt: PostPromptFacts | null }) => {
  const { t } = useI18n();
  if (prompt === null) return null;
  return (
    <section aria-label={t('postPrompt.label')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('postPrompt.label')}</p>
      <p className="mt-1 text-sm font-semibold text-primary" data-testid="post-prompt">
        {`${prompt.title} · v${prompt.version}`}
      </p>
    </section>
  );
};
