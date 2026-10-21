//---------------
// Tests for POST /api/cron/post-metrics: the cron-secret gate, the wiring
// of the real dependencies into the collector, and the PostHog flush.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/metrics/post-metrics', () => ({
  createPostMetricsStore: vi.fn(() => ({ listDuePosts: vi.fn(), saveMetrics: vi.fn() })),
  collectPostMetrics: vi.fn(),
}));
vi.mock('@/lib/metrics/provider-counters', () => ({ fetchProviderCounters: vi.fn() }));
vi.mock('@/lib/engine-tasks', () => ({ fetchEnginePublishResults: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/posthog-server', () => ({ flushPostHog: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '../post-metrics/route';
import { collectPostMetrics } from '@/lib/metrics/post-metrics';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';
import { fetchEnginePublishResults } from '@/lib/engine-tasks';
import { trackApiEvent } from '@/lib/analytics';
import { flushPostHog } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';

const REPORT = { checked: 2, recorded: 3, errors: [], truncated: false };

function requestWith(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('Authorization', `Bearer ${secret}`);
  return new Request('https://app.example/api/cron/post-metrics', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'cron-secret-value');
  vi.mocked(collectPostMetrics).mockResolvedValue(REPORT);
});

describe('POST /api/cron/post-metrics', () => {
  it('runs the collector with the real providers and flushes PostHog', async () => {
    const response = await POST(requestWith('cron-secret-value'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, report: REPORT });
    const deps = vi.mocked(collectPostMetrics).mock.calls[0][0];
    expect(deps.fetchPublishResults).toBe(fetchEnginePublishResults);
    expect(deps.fetchCounters).toBe(fetchProviderCounters);
    expect(deps.track).toBe(trackApiEvent);
    expect(flushPostHog).toHaveBeenCalledTimes(1);
  });

  it('logs the run errors at error level', async () => {
    vi.mocked(collectPostMetrics).mockResolvedValue({ ...REPORT, errors: ['post-1: publish results unavailable'] });
    await POST(requestWith('cron-secret-value'));
    expect(logger.error).toHaveBeenCalledWith('[cron/post-metrics] completed with errors', null, {
      errors: ['post-1: publish results unavailable'],
    });
  });

  it('rejects a missing or wrong secret with 401 without running', async () => {
    expect((await POST(requestWith(null))).status).toBe(401);
    expect((await POST(requestWith('wrong'))).status).toBe(401);
    expect(collectPostMetrics).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    const response = await POST(requestWith('cron-secret-value'));
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe('Post metrics are not configured.');
    expect(collectPostMetrics).not.toHaveBeenCalled();
  });
});
