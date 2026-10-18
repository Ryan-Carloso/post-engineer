'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// DetailProgressBar — the live generation progress bar shared by the slot
// and direct-generation detail views. One component so the two post kinds
// never drift in how they render progress.
//---------------
export function DetailProgressBar({ progress, stage }: { progress: number; stage: string | null }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-2xl bg-secondary p-6">
      <div className="flex items-center justify-between text-sm font-semibold text-[#0d2b45]">
        <span>{t('posts.videoGenerating')}</span>
        <span>{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#dce6ee]"
      >
        <div className="h-full rounded-full bg-[#0d2b45] transition-all" style={{ width: `${progress}%` }} />
      </div>
      {stage && <p className="mt-2 text-xs text-muted-foreground">{stage}</p>}
    </div>
  );
}
