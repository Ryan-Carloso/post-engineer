'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { SlotDetailPayload } from '@/lib/api';
import { buildGenerationRows } from './generation-rows';

export const GenerationFactsSection = ({
  generation,
  personaName,
}: {
  generation: SlotDetailPayload['generation'];
  personaName: string;
}) => {
  const { t } = useI18n();
  const rows = buildGenerationRows(generation, personaName, t);
  return (
    <section aria-label={t('posts.generationFactsLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.generationFactsLabel')}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {row.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-primary">{row.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
