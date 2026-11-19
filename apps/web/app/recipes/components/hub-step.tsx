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
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-on-ink">
          {number}
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id={`hub-step-${number}`} className="text-lg font-bold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-sm leading-6 text-muted-text">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
