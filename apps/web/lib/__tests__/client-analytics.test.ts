//---------------
// trackClientEvent — browser product analytics via posthog-js.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

import posthog from 'posthog-js';
import { trackClientEvent } from '@/lib/client-analytics';

describe('trackClientEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the event on the browser SDK with origin tags', () => {
    trackClientEvent('account_card_displayed', { provider: 'youtube', shown_label: 'Europa' });
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    const [event, props] = vi.mocked(posthog.capture).mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('account_card_displayed');
    expect(props).toMatchObject({
      provider: 'youtube',
      shown_label: 'Europa',
      source: 'web-client',
      environment: 'development',
      $lib: 'posthog-js',
    });
  });

  it('lets origin tags win over caller metadata', () => {
    trackClientEvent('account_card_displayed', { source: 'spoofed', environment: 'production' });
    const [, props] = vi.mocked(posthog.capture).mock.calls[0] as [string, Record<string, unknown>];
    expect(props['source']).toBe('web-client');
    expect(props['environment']).toBe('development');
  });

  it('redacts secret-bearing keys and credential fragments, and caps strings', () => {
    trackClientEvent('account_card_displayed', {
      password: 'hunter2',
      shown_label: 'Bearer abc.def and sk-abcdefghijklmnopqrst',
    });
    const [, props] = vi.mocked(posthog.capture).mock.calls[0] as [string, Record<string, unknown>];
    expect(props['password']).toBe('[redacted]');
    expect(props['shown_label']).toBe('Bearer [redacted] and [redacted]');
  });

  it('never throws when capture throws', () => {
    vi.mocked(posthog.capture).mockImplementationOnce(() => {
      throw new Error('posthog down');
    });
    expect(() => trackClientEvent('account_card_displayed', {})).not.toThrow();
  });
});
