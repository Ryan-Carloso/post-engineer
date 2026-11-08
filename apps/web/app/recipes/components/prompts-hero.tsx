import { ComposeIcon } from '@/lib/ui';

//---------------
// PromptsHero — hub header in the same shape as every dashboard
// page header (dark icon tile, h1, muted subtitle). Presentational.
//---------------

export default function PromptsHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-4 py-1 lg:py-2">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
        <ComposeIcon />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-[-0.035em] text-ink">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-text lg:text-base">{subtitle}</p>
      </div>
    </header>
  );
}
