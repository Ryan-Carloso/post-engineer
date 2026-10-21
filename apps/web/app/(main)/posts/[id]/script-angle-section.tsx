'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// ScriptAngleSection — the specific angle the engine turned the topic into
// before scripting. Read-only; renders nothing when no angle was recorded.
//---------------
export const ScriptAngleSection = ({ angle }: { angle: string | null }) => {
  const { t } = useI18n();
  if (angle === null) return null;
  return (
    <section aria-label={t('posts.scriptAngleLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('posts.scriptAngleLabel')}</p>
      <p className="mt-2 rounded-xl border border-input bg-secondary px-3 py-2 text-sm text-[#0d2b45]">{angle}</p>
    </section>
  );
};
