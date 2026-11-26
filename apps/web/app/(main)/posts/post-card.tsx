'use client';

import type { ScheduleConfig } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import type { Locale } from '@/lib/i18n';
import { scheduleAccountIds, type AccountOption } from '@/lib/account-options';
import { cn } from '@/lib/utils';
import { CALENDAR_GROUP_ICON, calendarGroupOf, type CalendarGroup } from './status';

export function formatDate(value: string, locale: Locale): string {
  return new Date(value).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' });
}

export function formatTime(value: string, locale: Locale): string {
  return new Date(value).toLocaleTimeString(locale === 'pt' ? 'pt-BR' : 'en-US', { timeStyle: 'short' });
}

export function resolveSlotAccounts(schedule: ScheduleConfig | undefined, accounts: AccountOption[]): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set(scheduleAccountIds(schedule));
  return accounts.filter((account) => ids.has(account.id));
}

export const StatusBadge = ({
  status,
  label,
  style,
  icon: IconOverride,
  iconClassName,
}: {
  status: string;
  label: string;
  style: string;
  icon?: (typeof CALENDAR_GROUP_ICON)[CalendarGroup];
  iconClassName?: string;
}) => {
  const Icon = IconOverride ?? CALENDAR_GROUP_ICON[calendarGroupOf(status)];
  return (
    <Badge variant="outline" data-status={status} className={cn('shrink-0 gap-1 border-transparent whitespace-nowrap', style)}>
      <Icon
        className={cn('size-3', iconClassName)}
        strokeWidth={IconOverride === undefined ? 3 : 2.5}
        aria-hidden
      />
      {label}
    </Badge>
  );
};
