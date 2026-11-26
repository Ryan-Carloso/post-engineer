'use client';

import { Switch } from '@/components/ui/switch';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { SectionDivider } from './persona-section-parts';

const PersonaAiLabelField = () => {
  const aiLabel = usePersonaStore((s) => s.aiLabel);
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor="persona-ai-label" className="text-sm font-semibold text-ink">
          {t('personas.aiLabelLabel')}
        </label>
        <p className="mt-1 text-xs leading-5 text-muted-text">{t('personas.aiLabelHint')}</p>
      </div>
      <Switch
        id="persona-ai-label"
        data-testid="persona-ai-label"
        checked={aiLabel}
        onCheckedChange={(checked) => usePersonaStore.getState().setAiLabel(checked)}
        className="mt-0.5"
      />
    </div>
  );
};

export function PersonaPreferencesSection() {
  const { t } = useI18n();
  return (
    <section>
      <SectionDivider label={t('personas.preferencesLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
        <PersonaAiLabelField />
      </div>
    </section>
  );
}
