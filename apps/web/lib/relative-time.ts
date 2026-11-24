import type { Locale } from '@/lib/i18n';

const LANGUAGE_TAGS: Record<Locale, string> = { en: 'en-US', pt: 'pt-BR' };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_WINDOW_DAYS = 30;

export function formatVersionDate(iso: string, locale: Locale, now: Date = new Date()): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return iso;
  const tag = LANGUAGE_TAGS[locale];
  const elapsed = now.getTime() - moment.getTime();
  if (elapsed < 0 || elapsed >= RELATIVE_WINDOW_DAYS * DAY_MS) {
    return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(moment);
  }
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  if (elapsed < MINUTE_MS) return relative.format(0, 'second');
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');
  return relative.format(-Math.floor(elapsed / DAY_MS), 'day');
}
