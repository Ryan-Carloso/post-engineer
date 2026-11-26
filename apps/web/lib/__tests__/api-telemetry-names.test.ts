import { describe, it, expect } from 'vitest';
import {
  API_TELEMETRY_NAMES,
  successEventName,
  rejectionEventName,
} from '@/lib/api-telemetry-names';

describe('api-telemetry-names', () => {
  it('maps a known route label to its semantic 2xx event name', () => {
    expect(successEventName('GET /api/schedule')).toBe(
      'schedule_fetched',
    );
    expect(successEventName('POST /api/persona')).toBe('persona_created');
    expect(successEventName('DELETE /api/schedule')).toBe('schedule_deleted');
  });

  it('derives the 4xx event name by appending _rejected ("rejected", not "failed": a 4xx is the caller erroring)', () => {
    expect(rejectionEventName('GET /api/schedule')).toBe(
      'schedule_fetched_rejected',
    );
    expect(rejectionEventName('POST /api/persona')).toBe(
      'persona_created_rejected',
    );
  });

  it('returns undefined for an unmapped label so the caller can fall back to the generic names', () => {
    expect(successEventName('GET /api/not-a-real-route')).toBeUndefined();
    expect(rejectionEventName('GET /api/not-a-real-route')).toBeUndefined();
  });

  it('matches labels exactly, including [id]-style path segments', () => {
    expect(successEventName('GET /api/schedule/slots/[slotId]')).toBe(
      'schedule_slot_fetched',
    );
    expect(successEventName('GET /api/schedule/slots/abc123')).toBeUndefined();
  });

  it('uses the repo PostHog convention (noun + past-tense verb, snake_case) for every entry', () => {
    for (const name of Object.values(API_TELEMETRY_NAMES)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('assigns a unique event name per route label (no two routes share one)', () => {
    const names = Object.values(API_TELEMETRY_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
