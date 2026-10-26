'use client';

import type { ReactNode } from 'react';
import { SECTION_LABEL_CLASS } from '@/lib/ui';

export const CARD_CLASS = 'rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6';

//---------------
// SectionTitle — section label in the same persona/personas pattern: icon
// + uppercase label + short hint.
//---------------
export const SectionTitle = ({ icon, label, hint }: { icon: ReactNode; label: string; hint?: string }) => (
  <div className="flex items-start gap-2.5">
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 [&_svg]:size-4">
      {icon}
    </span>
    <div>
      <p className={SECTION_LABEL_CLASS}>{label}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-neutral-500">{hint}</p> : null}
    </div>
  </div>
);
