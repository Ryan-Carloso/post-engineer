import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearLiveExperimentCache, loadLiveExperimentResults, type LiveExperimentDeps } from '../live';
import type { ExperimentFacts } from '../read';
import type { ExperimentMetricFact } from '../results';

//---------------
// Live experiment results (issue #532). The deps are injected so no
// test reaches Supabase, the engine or a provider API.
//---------------

const NOW = new Date('2026-11-10T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

function video(postId: string, variantId: string, pair: number, publishedAt: string | null, status = 'published') {
  return { postId, variantId, pair, status, title: 't', slotAt: '2026-11-10T10:00:00Z', publishedAt };
}

function factsFixture(overrides: Partial<ExperimentFacts> = {}): ExperimentFacts {
  const videos = [1, 2, 3].flatMap((pair) => [
    video(`calm-${pair}`, 'hook-calm', pair, '2026-11-10T10:00:00Z'),
    video(`aggr-${pair}`, 'hook-aggressive', pair, '2026-11-10T10:00:00Z'),
  ]);
  const metrics: ExperimentMetricFact[] = [1, 2, 3].flatMap((pair) => [
    { postId: `calm-${pair}`, provider: 'youtube', views: 100, likes: 1, comments: 0, averageViewDurationSeconds: 12 },
    { postId: `aggr-${pair}`, provider: 'youtube', views: 300, likes: 4, comments: 1, averageViewDurationSeconds: 20 },
  ]);
  return {
    experiment: {
      id: '7b0e6c1e-0000-4000-8000-000000000001',
      name: 'Hook test',
      variable: 'hook',
      personaId: null,
      targetPairs: 3,
      createdAt: '2026-11-10T09:00:00Z',
      variants: [
        { variantId: 'hook-calm', name: 'Calm question', description: 'Calm, curious opening.' },
        { variantId: 'hook-aggressive', name: 'Direct hook', description: 'Direct, provocative opening.' },
      ],
    },
    window: '7d',
    videos,
    metrics,
    truncated: false,
    ...overrides,
  };
}

function depsFixture(overrides: Partial<LiveExperimentDeps> = {}, facts: ExperimentFacts = factsFixture()): {
  deps: LiveExperimentDeps;
  fetchTaskSource: ReturnType<typeof vi.fn>;
  fetchCounters: ReturnType<typeof vi.fn>;
  loadTaskIds: ReturnType<typeof vi.fn>;
} {
  const fetchTaskSource = vi.fn(async (taskId: string) => ({
    publishResults: [
      {
        status: 'published',
        provider: 'youtube',
        accountId: 'acc-1',
        videoUrl: `https://www.youtube.com/watch?v=vid-${taskId}`,
      },
    ],
  }));
  // Live views flip the snapshot winner: calm 500 beats aggressive 250.
  const fetchCounters = vi.fn(async (_userId: string, target: { externalId: string }) => ({
    views: target.externalId.includes('calm') ? 500 : 250,
    likes: 2,
    comments: 1,
    saves: null,
  }));
  const loadTaskIds = vi.fn(async () => new Map(facts.videos.map((item) => [item.postId, `task-${item.postId}`] as const)));
  const deps: LiveExperimentDeps = {
    loadFacts: async () => ({ ok: true, value: facts }),
    loadTaskIds,
    fetchTaskSource,
    fetchCounters,
    now: () => NOW,
    ...overrides,
  };
  return { deps, fetchTaskSource, fetchCounters, loadTaskIds };
}

const INPUT = { userId: 'user-1', experimentId: '7b0e6c1e-0000-4000-8000-000000000001', window: '7d' as const };

beforeEach(() => {
  clearLiveExperimentCache();
});

describe('loadLiveExperimentResults', () => {
  it('replaces snapshot facts with live counters and recomputes the winner', async () => {
    const { deps, fetchCounters } = depsFixture();
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('live');
    expect(result.value.liveAt).toBe('2026-11-10T12:00:00.000Z');
    expect(result.value.frozen).toBe(false);
    expect(result.value.liveFailures).toEqual([]);
    expect(fetchCounters).toHaveBeenCalledTimes(6);
    const youtube = result.value.results.providers[0];
    expect(youtube.wins).toEqual({ 'hook-calm': 3, 'hook-aggressive': 0 });
    expect(youtube.comparisons[0].values['hook-calm'].views).toBe(500);
    expect(youtube.comparisons[0].values['hook-aggressive'].views).toBe(250);
  });

  it('keeps the snapshot fact and reports the failure when a provider read fails', async () => {
    const { deps, fetchCounters } = depsFixture();
    fetchCounters.mockRejectedValueOnce(new Error('token expired'));
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('partial');
    expect(result.value.liveFailures).toEqual([{ postId: 'calm-1', provider: 'youtube' }]);
    // The failed video keeps its snapshot views (100); the rest go live.
    const youtube = result.value.results.providers[0];
    expect(youtube.comparisons[0].values['hook-calm'].views).toBe(100);
    expect(youtube.comparisons[0].values['hook-aggressive'].views).toBe(250);
    // Pair 1 goes to the live aggressive video; pairs 2 and 3 go live calm.
    expect(youtube.wins).toEqual({ 'hook-calm': 2, 'hook-aggressive': 1 });
  });

  it('falls back to the full snapshot when every live read fails', async () => {
    const { deps } = depsFixture();
    const failing = { ...deps, fetchCounters: vi.fn(async () => { throw new Error('down'); }) };
    const result = await loadLiveExperimentResults(failing, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('snapshot');
    expect(result.value.liveAt).toBe(null);
    expect(result.value.liveFailures).toHaveLength(6);
    expect(result.value.results.providers[0].wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 3 });
  });

  it('never reads a provider once every published video is past 7d', async () => {
    const old = new Date(NOW.getTime() - 8 * 24 * HOUR_MS).toISOString();
    const facts = factsFixture({
      videos: factsFixture().videos.map((item) => ({ ...item, publishedAt: old })),
    });
    const { deps, fetchTaskSource, fetchCounters } = depsFixture({}, facts);
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('snapshot');
    expect(result.value.frozen).toBe(true);
    expect(fetchTaskSource).not.toHaveBeenCalled();
    expect(fetchCounters).not.toHaveBeenCalled();
  });

  it('stops the live read at the 24h window horizon but keeps it for 7d', async () => {
    const publishedAt = new Date(NOW.getTime() - 30 * HOUR_MS).toISOString();
    const facts = factsFixture({
      videos: factsFixture().videos.map((item) => ({ ...item, publishedAt })),
    });
    const day = depsFixture({}, facts);
    const result24 = await loadLiveExperimentResults(day.deps, { ...INPUT, window: '24h' });
    expect(result24.ok).toBe(true);
    if (!result24.ok) return;
    expect(result24.value.source).toBe('snapshot');
    expect(day.fetchCounters).not.toHaveBeenCalled();

    const week = depsFixture({}, facts);
    const result7 = await loadLiveExperimentResults(week.deps, INPUT);
    expect(result7.ok).toBe(true);
    if (!result7.ok) return;
    expect(result7.value.source).toBe('live');
    expect(week.fetchCounters).toHaveBeenCalledTimes(6);
  });

  it('does not read the 28d window live', async () => {
    const { deps, fetchCounters } = depsFixture();
    const result = await loadLiveExperimentResults(deps, { ...INPUT, window: '28d' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('snapshot');
    expect(fetchCounters).not.toHaveBeenCalled();
  });

  it('skips unpublished videos and videos without a task id', async () => {
    const facts = factsFixture();
    facts.videos[0] = { ...facts.videos[0], status: 'generating', publishedAt: null };
    const { deps, fetchCounters } = depsFixture(
      { loadTaskIds: async () => new Map(facts.videos.map((item) => [item.postId, item.postId === 'aggr-1' ? null : `task-${item.postId}`] as const)) },
      facts,
    );
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('partial');
    expect(result.value.liveFailures).toEqual([{ postId: 'aggr-1', provider: 'unknown' }]);
    // 4 live reads: the generating video is skipped, the task-less one fails.
    expect(fetchCounters).toHaveBeenCalledTimes(4);
  });

  it('adds a live fact for a video with no snapshot row yet', async () => {
    const facts = factsFixture({ metrics: [] });
    const { deps } = depsFixture({}, facts);
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('live');
    expect(result.value.results.providers).toHaveLength(1);
    expect(result.value.results.providers[0].comparisons).toHaveLength(3);
    expect(result.value.results.pairsPublished).toBe(3);
  });

  it('caches a live read for 5 minutes and refetches after the TTL', async () => {
    let now = NOW;
    const { deps, fetchCounters } = depsFixture({}, factsFixture());
    deps.now = () => now;
    await loadLiveExperimentResults(deps, INPUT);
    await loadLiveExperimentResults(deps, INPUT);
    expect(fetchCounters).toHaveBeenCalledTimes(6);
    now = new Date(NOW.getTime() + 6 * 60 * 1000);
    await loadLiveExperimentResults(deps, INPUT);
    expect(fetchCounters).toHaveBeenCalledTimes(12);
  });

  it('propagates a snapshot 404 without touching any provider', async () => {
    const { deps, fetchCounters } = depsFixture({ loadFacts: async () => ({ ok: false, status: 404 as const }) });
    const result = await loadLiveExperimentResults(deps, INPUT);
    expect(result).toEqual({ ok: false, status: 404 });
    expect(fetchCounters).not.toHaveBeenCalled();
  });
});
