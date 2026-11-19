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

const SECOND_TIME_ZONE = 'Europe/Lisbon';

export interface PostsSidebarProps {
  calendars: PersonaCalendar[];
  hiddenIds: ReadonlySet<string | null>;
  onTogglePersona: (id: string | null) => void;
  currentDate: Date;
  weekStartsOn: 0 | 1;
  locale: Locale;
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
  const now = useNow();
  const localeTag = INTL_TAG[locale];
  const viewerLabel = getTimeZoneCity(viewerTimeZone) || viewerTimeZone;

  return (
    <aside data-testid="posts-sidebar" className={cn('hidden w-60 shrink-0 lg:block', className)}>
      <div className="sticky top-0">
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
