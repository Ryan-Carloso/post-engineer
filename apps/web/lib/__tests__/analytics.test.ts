//---------------
// analytics — 2xx success event tracking via PostHog
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trackApiEvent, trackApiEventAs } from '@/lib/analytics';

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

describe('trackApiEventAs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures the event against the given user', () => {
    const capture = vi.fn();
    const captureAs = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ capture, captureAs });
    trackApiEventAs('user-1', 'experiment_video_linked', { experiment_id: 'exp-1' });
    expect(capture).not.toHaveBeenCalled();
    expect(captureAs).toHaveBeenCalledTimes(1);
    const [distinctId, event, props] = captureAs.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(distinctId).toBe('user-1');
    expect(event).toBe('experiment_video_linked');
    expect(props).toMatchObject({ experiment_id: 'exp-1', $lib: 'posthog-server' });
  });

  it('redacts secret-bearing keys like trackApiEvent', () => {
    const captureAs = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ captureAs });
    trackApiEventAs('user-1', 'test', { apiKey: 'sk-123', safe: 'ok' });
    const props = captureAs.mock.calls[0][2] as Record<string, unknown>;
    expect(props.apiKey).not.toBe('sk-123');
    expect(props.safe).toBe('ok');
  });

  it('never throws when PostHog is not configured', () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => trackApiEventAs('user-1', 'x', {})).not.toThrow();
  });
});
