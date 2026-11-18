'use client';

import { useMemo } from 'react';
import { MiniCalendar } from '@/components/mini-calendar';
import { Kbd } from '@/components/ui/kbd';
import { Switch } from '@/components/ui/switch';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useNow } from '@/hooks/use-now';
import { getTimeZoneCity } from '@/lib/timezone-label';
import { SECTION_LABEL_CLASS } from '@/lib/ui';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { INTL_TAG, dayKey } from './calendar-days';
import type { PersonaCalendar } from './persona-filter';

//---------------
// PostsSidebar — the /posts left sidebar, the CalendarCN demo sidebar's
// shape (mini calendar, calendar toggles, views, second time zone) with
// this page's data: the mini calendar navigates the month and picks the
// day, the toggles filter by persona, the views row lists only the month
// view (week/day/year do not exist yet), and the second-timezone box only
// displays the viewer's zone and Lisbon. A desktop layout element: hidden
// below lg, so smaller screens keep the month grid and the day list below
// it unchanged. No logo here: the app shell already carries the brand.
//---------------

// The second time zone shown beside the viewer's own (read by the week
// view from its stored setting; here it is display only).
const SECOND_TIME_ZONE = 'Europe/Lisbon';

export interface PostsSidebarProps {
  calendars: PersonaCalendar[];
  hiddenIds: ReadonlySet<string | null>;
  onTogglePersona: (id: string | null) => void;
  /** First day of the shown month, owned by the page. */
  currentDate: Date;
  weekStartsOn: 0 | 1;
  locale: Locale;
  /** A day was picked in the mini calendar: the page lists its posts. */
  onSelectDay: (key: string) => void;
  className?: string;
}

function formatZoneTime(now: Date, localeTag: string, timeZone: string): string {
  return new Intl.DateTimeFormat(localeTag, { hour: '2-digit', minute: '2-digit', timeZone }).format(now);
}

export function PostsSidebar({
  calendars,
  hiddenIds,
  onTogglePersona,
  currentDate,
  weekStartsOn,
  locale,
  onSelectDay,
  className,
}: PostsSidebarProps) {
  const { t } = useI18n();
  const viewerTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // The shared clock: null during server rendering and hydration, the real
  // time right after. The box renders a dash until the time is known, so
  // the server markup matches the first client render — a live `new Date()`
  // here renders a different minute whenever hydration straddles the
  // boundary, and React fails the page with error #418.
  const now = useNow();
  const localeTag = INTL_TAG[locale];
  const viewerLabel = getTimeZoneCity(viewerTimeZone) || viewerTimeZone;

  return (
    <aside data-testid="posts-sidebar" className={cn('hidden w-60 shrink-0 lg:block', className)}>
      <div className="sticky top-0">
        {/* The mini calendar's tooltips need a provider: the app has none
            at the root, so the sidebar provides one for its own subtree,
            like the vendored header does for its tooltips. */}
        <TooltipProvider>
          <MiniCalendar
            currentDate={currentDate}
            onDateSelect={(date) => onSelectDay(dayKey(date))}
            weekStartsOn={weekStartsOn}
            showWeekNumber={false}
          />
        </TooltipProvider>
        {calendars.length > 0 && (
          <div className="mt-4">
            <p className={SECTION_LABEL_CLASS}>{t('posts.sidebarCalendars')}</p>
            <div className="mt-2 space-y-0.5">
              {calendars.map((calendar) => (
                <label
                  key={calendar.id ?? 'faceless'}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sunken"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-primary">{calendar.name}</span>
                  <Switch
                    checked={!hiddenIds.has(calendar.id)}
                    onCheckedChange={() => onTogglePersona(calendar.id)}
                    aria-label={calendar.name}
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4">
          <p className={SECTION_LABEL_CLASS}>{t('posts.sidebarViews')}</p>
          <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-sunken px-2 py-1.5">
            <span className="text-sm font-semibold text-primary">{t('posts.sidebarViewMonth')}</span>
            <Kbd className="ml-auto">M</Kbd>
          </div>
        </div>
        <div className="mt-4">
          <p className={SECTION_LABEL_CLASS}>{t('posts.sidebarSecondTimezone')}</p>
          <div className="mt-2 rounded-xl border border-line bg-card px-3 py-2.5 text-sm">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-primary">{viewerLabel}</span>
              <span className="font-semibold text-primary tabular-nums">
                {now === null ? '—' : formatZoneTime(now, localeTag, viewerTimeZone)}
              </span>
            </p>
            <p className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-primary">{t('posts.sidebarLisbon')}</span>
              <span className="font-semibold text-primary tabular-nums">
                {now === null ? '—' : formatZoneTime(now, localeTag, SECOND_TIME_ZONE)}
              </span>
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
