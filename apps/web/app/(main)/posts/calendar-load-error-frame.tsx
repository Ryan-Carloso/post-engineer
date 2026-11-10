'use client';

import { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { INTL_TAG } from './calendar-days';
import { CalendarLegend } from './calendar-legend';

const NAV_ARROW_CLASS =
  'inline-flex size-10 items-center justify-center rounded-md p-0 text-muted-foreground opacity-70 transition-colors select-none [&_svg]:size-5 [&_svg]:stroke-[2.5]';

const NAV_INERT_CLASS =
  'pointer-events-none cursor-not-allowed border border-line bg-sunken/80 text-muted-foreground shadow-none';

function weekdayLabels(locale: Locale, firstWeekday: 0 | 1): string[] {
  const weekdayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => {
    const dayOffset = (firstWeekday + index) % 7;
    const date = new Date(2024, 0, 7 + dayOffset);
    return weekdayFormat.format(date).replace(/\.$/, '');
  });
}

export function CalendarUnavailableFrame({
  year,
  month,
  firstWeekday,
  filtered = false,
  legendClassName,
  showLegend = true,
  children,
}: {
  year: number;
  month: number;
  firstWeekday: 0 | 1;
  filtered?: boolean;
  legendClassName?: string;
  showLegend?: boolean;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(
        new Date(year, month, 1),
      ),
    [locale, month, year],
  );
  const weekdays = useMemo(() => weekdayLabels(locale, firstWeekday), [firstWeekday, locale]);

  return (
    <div data-calendar-unavailable-frame className="w-full">
      {showLegend && (
        <div className={cn('mb-2 border-b border-line pb-2', legendClassName)}>
          <CalendarLegend filtered={filtered} />
        </div>
      )}
      <div className="relative w-full">
        <div className="flex min-h-10 w-full items-center justify-start pr-44">
          <p className="text-base font-bold capitalize text-primary">{monthLabel}</p>
        </div>
        <nav aria-disabled data-calendar-error-nav className="absolute top-0 right-0 flex shrink-0 items-center gap-0.5 pr-0.5">
          <button
            type="button"
            disabled
            tabIndex={-1}
            aria-disabled
            aria-label={t('posts.calendarPrevMonth')}
            className={cn(NAV_ARROW_CLASS, NAV_INERT_CLASS)}
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            type="button"
            disabled
            tabIndex={-1}
            aria-disabled
            className={cn('h-10 rounded-md px-3 text-sm font-semibold', NAV_INERT_CLASS)}
          >
            {t('posts.calendarGoToToday')}
          </button>
          <button
            type="button"
            disabled
            tabIndex={-1}
            aria-disabled
            aria-label={t('posts.calendarNextMonth')}
            className={cn(NAV_ARROW_CLASS, NAV_INERT_CLASS)}
          >
            <ChevronRight aria-hidden />
          </button>
        </nav>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {weekdays.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-0.5 pb-1 text-center text-xs font-medium capitalize text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <div
        data-calendar-grid-footprint
        className="mt-2 min-h-[14rem] w-full rounded-lg border border-line bg-card sm:min-h-[16rem] xl:min-h-[20rem]"
      >
        <div
          data-calendar-load-error
          className="w-full border-b border-warning/35 bg-warning/12 px-4 py-4 sm:px-5"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
