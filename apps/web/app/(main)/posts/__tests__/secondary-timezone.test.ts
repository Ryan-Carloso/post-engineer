import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  DEFAULT_SECONDARY_TIME_ZONE,
  SECONDARY_TIME_ZONE_STORAGE_KEY,
  readSecondaryTimeZone,
} from '../secondary-timezone';

describe('readSecondaryTimeZone', () => {
  afterEach(() => {
    window.localStorage.removeItem(SECONDARY_TIME_ZONE_STORAGE_KEY);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to Lisbon when nothing is stored', () => {
    expect(readSecondaryTimeZone()).toBe('Europe/Lisbon');
    expect(DEFAULT_SECONDARY_TIME_ZONE).toBe('Europe/Lisbon');
  });

  it('returns a stored valid zone', () => {
    window.localStorage.setItem(SECONDARY_TIME_ZONE_STORAGE_KEY, 'America/Sao_Paulo');
    expect(readSecondaryTimeZone()).toBe('America/Sao_Paulo');
  });

  it('falls back to Lisbon for a stored zone the runtime does not know', () => {
    window.localStorage.setItem(SECONDARY_TIME_ZONE_STORAGE_KEY, 'Mars/Olympus');
    expect(readSecondaryTimeZone()).toBe('Europe/Lisbon');
  });

  it('falls back to Lisbon when storage throws', () => {
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(readSecondaryTimeZone()).toBe('Europe/Lisbon');
  });
});
