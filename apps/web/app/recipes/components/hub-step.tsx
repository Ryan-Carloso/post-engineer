import type { Ref } from 'react';
import { cn } from '@/lib/utils';

export default function HubStep({
  number,
  title,
  hint,
  children,
  sectionRef,
  highlighted = false,
  dimmed = false,
}: {
  number: number;
  title: string;
  hint: string;
  children: React.ReactNode;
  sectionRef?: Ref<HTMLElement>;
  highlighted?: boolean;
  dimmed?: boolean;
}): React.ReactElement {
  return (
    <section
      ref={sectionRef}
      aria-labelledby={`hub-step-${number}`}
      data-testid={`hub-step-${number}`}
      data-highlighted={highlighted}
      data-dimmed={dimmed}
      className={cn(
        'flex scroll-mt-6 flex-col gap-4 rounded-2xl transition-[opacity,box-shadow] duration-500',
        highlighted && 'ring-2 ring-brand ring-offset-2',
        dimmed && 'opacity-55 focus-within:opacity-100 hover:opacity-100',
      )}
    >
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
