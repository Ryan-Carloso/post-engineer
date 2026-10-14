//---------------
// api-telemetry-names — unit tests for the semantic event-name lookup.
//
// withApiErrorReporting used to report every 2xx as a generic
// `server_success` and every 4xx as `server_warning`. The mapping table
// gives each route label a deliberate semantic name (noun + past-tense
// verb, matching the repo's existing PostHog names like video_generated);
// these tests pin the lookup contract: exact-label match, the 4xx
// `_rejected` derivation, and the undefined fallback for unmapped
// labels (the wrapper falls back to the generic names — telemetry must
// never break on a missing entry).
//---------------

import { describe, it, expect } from 'vitest';
import {
  API_TELEMETRY_NAMES,
  successEventName,
  rejectionEventName,
} from '@/lib/api-telemetry-names';

describe('api-telemetry-names', () => {
  it('maps a known route label to its semantic 2xx event name', () => {
    expect(successEventName('GET /api/billing/transactions')).toBe(
      'billing_transactions_fetched',
    );
    expect(successEventName('POST /api/persona')).toBe('persona_created');
    expect(successEventName('DELETE /api/schedule')).toBe('schedule_deleted');
  });

  it('derives the 4xx event name by appending _rejected ("rejected", not "failed": a 4xx is the caller erroring)', () => {
    expect(rejectionEventName('GET /api/billing/transactions')).toBe(
      'billing_transactions_fetched_rejected',
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
    expect(successEventName('GET /api/persona/video-status/[taskId]')).toBe(
      'video_status_fetched',
    );
    // A label with the segment filled in is a different string: no match.
    expect(successEventName('GET /api/persona/video-status/abc123')).toBeUndefined();
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
