'use client';

import { useI18n } from '@/lib/i18n/provider';

export const ScriptAngleSection = ({ angle }: { angle: string | null }) => {
  const { t } = useI18n();
  if (angle === null) return null;
  return (
    <section aria-label={t('posts.scriptAngleLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('posts.scriptAngleLabel')}</p>
      <p className="mt-2 rounded-xl border border-input bg-secondary px-3 py-2 text-sm text-primary">{angle}</p>
    </section>
  );
};
