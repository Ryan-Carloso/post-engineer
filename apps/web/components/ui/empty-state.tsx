import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

//---------------
// EmptyState — the one "nothing here yet" block. Every list, panel and
// filter result renders this instead of a local dashed box, so an empty
// screen always offers the same icon, the same sentence shape and one
// next step. Presentational: the caller owns the copy and the action.
//---------------
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      data-empty-state
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed border-line bg-card text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted-text">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-primary">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action !== undefined && <div className="mt-2 w-full min-w-0">{action}</div>}
    </div>
  );
}
