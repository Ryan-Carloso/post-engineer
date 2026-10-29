import { ComposeIcon } from "@/lib/ui";

//---------------
// PromptsHero — hub header in the same shape as every dashboard
// page header (dark icon tile, h1, muted subtitle), plus the total
// prompt count on the right. Presentational.
//---------------

export default function PromptsHero({
  title,
  subtitle,
  countLabel,
}: {
  title: string;
  subtitle: string;
  countLabel: string;
}) {
  return (
    <header className="flex flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between lg:py-2">
      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
          <ComposeIcon />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-[#101728]">
            {title}
          </h1>
          <p className="mt-0.5 text-sm text-[#718096] lg:text-base">
            {subtitle}
          </p>
        </div>
      </div>
      <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-[#edf0f4] bg-white px-3.5 py-1 text-sm font-semibold text-[#414d63]">
        {countLabel}
      </span>
    </header>
  );
}
