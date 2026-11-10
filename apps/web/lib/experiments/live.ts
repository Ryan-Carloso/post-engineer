//---------------
// Live experiment results (issue #532). The snapshot read only sees a
// video once its window snapshot exists (24-48h after publish); this
// module re-reads the live provider counters for videos still inside
// their window and recomputes the same paired results from the merged
// facts — the math in results.ts is untouched.
//
// Honesty rules:
// - A live counter is cumulative since publish, so it only stands in for
//   a window while that window is still open: a video stops being
//   live-read once its window closes (publish + 24h for the 24h window,
//   publish + 7d for 7d). After that the snapshot is the value.
// - A failed provider read never becomes a zero: the snapshot fact stays
//   and the failure is reported, so the page can say the numbers are
//   stale instead of showing a fake live 0.
// - Reads are cached per experiment + window for LIVE_CACHE_TTL_MS, so
//   polling the page does not hammer the provider APIs on every view.
//   The cache lives in module memory (one web instance); a restart or a
//   new deploy clears it, which only costs one fresh read.
//---------------

import { computeExperimentResults, type ExperimentMetricFact } from './results';
import type { ExperimentDetail, ExperimentFacts, ReadResult } from './read';
import type { MetricsWindow } from '@/lib/metrics/metrics-query';
import { METRICS_WINDOW_START_HOURS } from '@/lib/metrics/metrics-query';
import { metricsTargets, type MetricsCounters, type MetricsTarget } from '@/lib/metrics/post-metrics';

// Live reads are cached this long per experiment + window.
export const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
// Live updates stop 7d after publish (issue #532): after that the 7d
// snapshot is final and no provider is read again.
export const LIVE_FREEZE_HOURS = 168;

export type LiveSource = 'live' | 'partial' | 'snapshot';

export interface LiveFailure {
  postId: string;
  provider: string;
}

export interface LiveExperimentDetail extends ExperimentDetail {
  /** 'live': every eligible video read fresh. 'partial': at least one read failed. 'snapshot': no fresh read. */
  source: LiveSource;
  /** When the live counters were read; null when nothing was read live. */
  liveAt: string | null;
  /** Eligible videos/providers whose live read failed (snapshot kept). */
  liveFailures: LiveFailure[];
  /** True once every published video is past publish + 7d. */
  frozen: boolean;
}

export interface LiveExperimentDeps {
  loadFacts: () => Promise<ReadResult<ExperimentFacts>>;
  loadTaskIds: () => Promise<Map<string, string | null> | { error: unknown }>;
  fetchTaskSource: (taskId: string, userId: string) => Promise<{ publishResults: unknown[] }>;
  fetchCounters: (userId: string, target: MetricsTarget, context: { window: MetricsWindow; now: Date }) => Promise<MetricsCounters>;
  now: () => Date;
}

interface CacheEntry {
  fetchedAt: number;
  value: LiveExperimentDetail;
}

const cache = new Map<string, CacheEntry>();

export function clearLiveExperimentCache(): void {
  cache.clear();
}

function windowHours(window: MetricsWindow): number {
  // A live counter is cumulative since publish, so it only stands in for
  // a window while that window's span is still running: until publish +
  // 24h for the 24h window and publish + 7d for the 7d window. Past that
  // the cumulative count exceeds the window's span and the snapshot is
  // the value. METRICS_WINDOW_START_HOURS pins those spans (24 / 168).
  return METRICS_WINDOW_START_HOURS[window];
}

function isLiveWindow(window: MetricsWindow): window is '24h' | '7d' {
  return window === '24h' || window === '7d';
}

export async function loadLiveExperimentResults(
  deps: LiveExperimentDeps,
  input: { userId: string; experimentId: string; window: MetricsWindow },
): Promise<ReadResult<LiveExperimentDetail>> {
  const { userId, experimentId, window } = input;
  const now = deps.now();
  const facts = await deps.loadFacts();
  if (!facts.ok) return facts;
  const { experiment, videos, metrics, truncated } = facts.value;
  const [first, second] = experiment.variants;

  const published = videos.filter(
    (video) => video.status === 'published' && video.publishedAt !== null,
  );
  const frozen =
    published.length > 0
    && published.every(
      (video) => now.getTime() >= Date.parse(video.publishedAt as string) + LIVE_FREEZE_HOURS * 60 * 60 * 1000,
    );
  const snapshotDetail: LiveExperimentDetail = {
    experiment,
    window,
    videos,
    results: computeExperimentResults({
      variantIds: [first.variantId, second.variantId],
      targetPairs: experiment.targetPairs,
      slots: videos.map((video) => ({ postId: video.postId, variantId: video.variantId, pair: video.pair, status: video.status })),
      metrics,
    }),
    truncated,
    source: 'snapshot',
    liveAt: null,
    liveFailures: [],
    frozen,
  };
  // No live window (28d), nothing published, or everything frozen: the
  // snapshot is the answer and no provider is touched.
  if (!isLiveWindow(window) || frozen || published.length === 0) return { ok: true, value: snapshotDetail };

  const horizonMs = windowHours(window) * 60 * 60 * 1000;
  const liveVideos = published.filter(
    (video) => now.getTime() < Date.parse(video.publishedAt as string) + horizonMs,
  );
  if (liveVideos.length === 0) return { ok: true, value: snapshotDetail };

  const cacheKey = `${userId}:${experimentId}:${window}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined && now.getTime() - cached.fetchedAt < LIVE_CACHE_TTL_MS) {
    return { ok: true, value: cached.value };
  }

  const taskIds = await deps.loadTaskIds();
  if (!(taskIds instanceof Map)) {
    return { ok: false, status: 500, cause: taskIds.error };
  }

  const liveFacts = new Map<string, ExperimentMetricFact>();
  const liveFailures: LiveFailure[] = [];
  for (const video of liveVideos) {
    const taskId = taskIds.get(video.postId) ?? null;
    if (taskId === null) {
      liveFailures.push({ postId: video.postId, provider: 'unknown' });
      continue;
    }
    let targets: MetricsTarget[];
    try {
      const source = await deps.fetchTaskSource(taskId, userId);
      targets = metricsTargets(source.publishResults).targets;
    } catch {
      liveFailures.push({ postId: video.postId, provider: 'unknown' });
      continue;
    }
    for (const target of targets) {
      try {
        const counters = await deps.fetchCounters(userId, target, { window, now });
        liveFacts.set(`${video.postId}:${target.provider}`, {
          postId: video.postId,
          provider: target.provider,
          views: counters.views,
          likes: counters.likes,
          comments: counters.comments,
          averageViewDurationSeconds: counters.retention?.averageViewDurationSeconds ?? null,
        });
      } catch {
        liveFailures.push({ postId: video.postId, provider: target.provider });
      }
    }
  }

  // No provider answered: the snapshot stands, with the failures listed.
  if (liveFacts.size === 0) {
    const value: LiveExperimentDetail = { ...snapshotDetail, liveFailures };
    return { ok: true, value };
  }
  const merged = metrics.map((fact) => liveFacts.get(`${fact.postId}:${fact.provider}`) ?? fact);
  // A live video/provider with no snapshot row yet has no fact to replace:
  // append it so the pair compares instead of staying undecided.
  for (const fact of liveFacts.values()) {
    if (!metrics.some((row) => row.postId === fact.postId && row.provider === fact.provider)) {
      merged.push(fact);
    }
  }
  const value: LiveExperimentDetail = {
    ...snapshotDetail,
    results: computeExperimentResults({
      variantIds: [first.variantId, second.variantId],
      targetPairs: experiment.targetPairs,
      slots: videos.map((video) => ({ postId: video.postId, variantId: video.variantId, pair: video.pair, status: video.status })),
      metrics: merged,
    }),
    source: liveFailures.length === 0 ? 'live' : 'partial',
    liveAt: now.toISOString(),
    liveFailures,
  };
  cache.set(cacheKey, { fetchedAt: now.getTime(), value });
  return { ok: true, value };
}
