//---------------
// HubStep — one numbered step of the prompts hub (1 key, 2 setup,
// 3 recipes): a number badge, a title, a one-line hint, and the step's
// content below. The hub is the only numbered multi-section flow in the
// app, so there is no shared primitive to reuse. Presentational.
//---------------

export default function HubStep({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section aria-labelledby={`hub-step-${number}`} className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#101728] text-sm font-bold text-white">
          {number}
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id={`hub-step-${number}`} className="text-lg font-bold tracking-tight text-[#101728]">
            {title}
          </h2>
          <p className="mt-0.5 text-sm leading-6 text-[#718096]">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
