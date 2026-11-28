// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackApiEvent = vi.fn();
const trackApiEventAs = vi.fn();

vi.mock('@/lib/analytics', () => ({
  trackApiEvent: (...args: unknown[]) => trackApiEvent(...args),
  trackApiEventAs: (...args: unknown[]) => trackApiEventAs(...args),
}));

import {
  partialFailureProperties,
  providerFailedProperties,
  publishFailedProperties,
  publishTrackingContext,
  trackPublishEvent,
} from '@/lib/publisher/events';
import { makeSchedule, makeSlot } from './helpers';

describe('trackPublishEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attributes the event to the user when the properties name one', () => {
    trackPublishEvent('video_published', { user_id: 'user-1', slotId: 's' });
    expect(trackApiEventAs).toHaveBeenCalledWith('user-1', 'video_published', { user_id: 'user-1', slotId: 's' });
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ user_id: '' }], [{ user_id: 'unknown' }], [{ user_id: 7 }]])('falls back to the server identity for %j', (properties) => {
    trackPublishEvent('video_published', properties);
    expect(trackApiEvent).toHaveBeenCalledWith('video_published', properties);
    expect(trackApiEventAs).not.toHaveBeenCalled();
  });
});

describe('publish event properties', () => {
  it('names the slot, the owner, the schedule and the persona', () => {
    expect(publishTrackingContext(makeSlot())).toEqual({
      slotId: 'slot-1',
      user_id: 'user-1',
      schedule_id: 'schedule-1',
      persona_id: 'persona-1',
    });
  });

  it('omits blank identity values', () => {
    const slot = makeSlot({ userId: null, schedule: makeSchedule({ id: null, personaId: null }) });
    expect(publishTrackingContext(slot)).toEqual({ slotId: 'slot-1' });
  });

  it('a provider failure carries the status and a never-empty scrubbed reason', () => {
    const properties = providerFailedProperties(makeSlot(), { provider: 'youtube', status: 401, message: 'denied token=abc' });
    expect(properties).toMatchObject({ provider: 'youtube', status_code: 401, reason: 'denied token=[redacted]' });
    const empty = providerFailedProperties(makeSlot(), { provider: '', status: null, message: '' });
    expect(empty).toMatchObject({ provider: 'unknown', status_code: null, reason: 'Error' });
  });

  it('a publish failure keeps its extra fields and falls back to Error', () => {
    expect(publishFailedProperties(makeSlot(), '', { retryable: true, attempts: 2 })).toMatchObject({
      reason: 'Error',
      retryable: true,
      attempts: 2,
    });
  });

  it('a partial failure prefers the first error, then the failed providers, then a constant', () => {
    expect(partialFailureProperties(makeSlot(), ['youtube'], ['bluesky'], 'bad media')).toMatchObject({
      failed_providers: ['youtube'],
      published_providers: ['bluesky'],
      reason: 'bad media',
    });
    expect(partialFailureProperties(makeSlot(), ['youtube', 'rumble'], [], '').reason).toBe('youtube,rumble');
    expect(partialFailureProperties(makeSlot(), [], [], '').reason).toBe('partial_failure');
  });
});
