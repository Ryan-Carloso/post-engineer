//---------------
// analytics — 2xx success event tracking via PostHog
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trackApiEvent } from '@/lib/analytics';

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

import { getPostHogServer } from '@/lib/posthog-server';

describe('trackApiEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the event with properties via PostHog', () => {
    const capture = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ capture });
    trackApiEvent('schedule_created', { scheduleId: 'abc', provider: 'youtube' });
    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = (capture as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('schedule_created');
    expect(props).toMatchObject({ scheduleId: 'abc', provider: 'youtube' });
  });

  it('does nothing (never throws) when PostHog is not configured', () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => trackApiEvent('x', {})).not.toThrow();
  });

  it('redacts secret-bearing property keys', () => {
    const capture = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ capture });
    trackApiEvent('test', { password: 'hunter2', apiKey: 'sk-123', safe: 'ok' });
    const [, props] = (capture as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(props['password']).toBe('[redacted]');
    expect(props['apiKey']).toBe('[redacted]');
    expect(props['safe']).toBe('ok');
  });

  it('redacts secret-bearing keys in nested properties (shared recursive scrub)', () => {
    const capture = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ capture });
    trackApiEvent('test', { outer: { apiKey: 'sk-123', n: 1 } });
    const [, props] = (capture as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect((props['outer'] as Record<string, unknown>)['apiKey']).toBe('[redacted]');
    expect((props['outer'] as Record<string, unknown>)['n']).toBe(1);
  });

  it('never throws even if capture throws', () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({
      capture: () => { throw new Error('boom'); },
    });
    expect(() => trackApiEvent('x', {})).not.toThrow();
  });
});
