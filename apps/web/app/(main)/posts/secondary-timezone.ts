//---------------
// Secondary time zone for the posts calendar's week view.
//
// Slots are stored in Lisbon time, so Lisbon is the secondary zone by
// default; the viewer zone stays primary. The value lives in localStorage
// (no settings UI yet — that comes with the sidebar) and is validated
// against the runtime: an unknown stored zone falls back to the default
// instead of breaking the axis labels.
//---------------

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
    // Storage unavailable (private mode, disabled cookies): the default
    // still renders; the setting just does not persist.
  }
  return DEFAULT_SECONDARY_TIME_ZONE;
}
