export const DEFAULT_SECONDARY_TIME_ZONE = 'Europe/Lisbon';

export const SECONDARY_TIME_ZONE_STORAGE_KEY = 'posts-secondary-timezone';

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function readSecondaryTimeZone(): string {
  if (typeof window === 'undefined') return DEFAULT_SECONDARY_TIME_ZONE;
  try {
    const stored = window.localStorage.getItem(SECONDARY_TIME_ZONE_STORAGE_KEY);
    if (stored !== null && isKnownTimeZone(stored)) return stored;
  } catch {
  }
  return DEFAULT_SECONDARY_TIME_ZONE;
}
