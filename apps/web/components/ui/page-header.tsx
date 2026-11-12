import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

//---------------
// PageHeader — the one title block every authenticated page uses. Screens
// pass their own actions (refresh, create, filters) so the title, the
// supporting line and the action cluster keep one rhythm across the app.
//---------------
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] text-primary">{title}</h1>
        {description !== undefined && (
          <p className="mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
