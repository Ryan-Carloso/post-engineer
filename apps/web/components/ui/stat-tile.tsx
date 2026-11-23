import { cn } from '@/lib/utils';

export const CARD_CLASS = 'rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]';

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className={cn(CARD_CLASS, 'p-4')}>
      <p className="text-xs font-semibold text-muted-text">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tracking-[-0.03em] text-ink">{value}</p>
      {hint !== undefined && <p className="text-xs text-muted-text tabular-nums">{hint}</p>}
    </div>
  );
}
