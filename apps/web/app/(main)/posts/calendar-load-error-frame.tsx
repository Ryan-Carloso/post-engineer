'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { CalendarLegend } from './calendar-legend';
import { calendarWeekdayShortLabels, formatCalendarMonthCaption } from './calendar-days';
import { CALENDAR_LAYOUT_CLASS } from './loading-skeleton';

// Inert month controls — same muted treatment as disabled filters on /posts.
const NAV_DISABLED_CLASS =
  'pointer-events-none cursor-not-allowed border border-line bg-sunken/90 text-muted-foreground opacity-55 shadow-none saturate-50';

const NAV_ARROW_CLASS =
  'inline-flex size-10 items-center justify-center rounded-md p-0 select-none [&_svg]:size-5 [&_svg]:stroke-[2.5]';

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
  const monthLabel = formatCalendarMonthCaption(year, month, locale);
  const weekdays = calendarWeekdayShortLabels(locale, firstWeekday);

  return (
    <div data-calendar-unavailable-frame className="w-full">
      {showLegend && (
        <div className={cn('mb-2 border-b border-line pb-2', legendClassName)}>
          <CalendarLegend filtered={filtered} />
        </div>
      )}
      <div className={cn('w-full', CALENDAR_LAYOUT_CLASS)}>
        <div data-calendar-error-chrome className="min-w-0">
          <div
            data-calendar-error-month-row
            className="mb-1 grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 sm:gap-2"
          >
            <p className="min-w-0 truncate text-base font-bold capitalize text-primary">{monthLabel}</p>
            <nav
              aria-disabled
              data-calendar-error-nav
              className="flex shrink-0 flex-nowrap items-center justify-end gap-0.5 max-xl:gap-1"
            >
              <button
                type="button"
                disabled
                tabIndex={-1}
                aria-disabled
                aria-label={t('posts.calendarPrevMonth')}
                className={cn(NAV_ARROW_CLASS, NAV_DISABLED_CLASS)}
              >
                <ChevronLeft aria-hidden />
              </button>
              <button
                type="button"
                disabled
                tabIndex={-1}
                aria-disabled
                className={cn(
                  'h-10 max-w-[7.25rem] truncate rounded-md px-2 text-xs font-semibold sm:max-w-none sm:px-3 sm:text-sm',
                  NAV_DISABLED_CLASS,
                )}
              >
                {t('posts.calendarGoToToday')}
              </button>
              <button
                type="button"
                disabled
                tabIndex={-1}
                aria-disabled
                aria-label={t('posts.calendarNextMonth')}
                className={cn(NAV_ARROW_CLASS, NAV_DISABLED_CLASS)}
              >
                <ChevronRight aria-hidden />
              </button>
            </nav>
          </div>
          <table data-calendar-error-weekdays className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                {weekdays.map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="w-[14.2857%] px-0.5 pb-1 text-center text-xs font-medium capitalize text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div className="hidden min-w-0 xl:block" aria-hidden />
        <div
          data-calendar-grid-footprint
          className={cn(
            'mt-2 flex min-h-[14rem] w-full items-center justify-center rounded-lg border border-line bg-card p-4 sm:min-h-[16rem] xl:col-span-2 xl:min-h-[20rem]',
          )}
        >
          <div
            data-calendar-load-error
            className="w-full max-w-2xl rounded-lg border border-warning/35 bg-warning/12 px-4 py-4 sm:px-5"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
