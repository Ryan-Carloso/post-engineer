import { describe, it, expect } from 'vitest';
import {
  CLEAR_P_VALUE,
  computeExperimentResults,
  signTestPValue,
  type ExperimentMetricFact,
  type ExperimentSlotFact,
} from '@/lib/experiments/results';

const VARIANTS = ['hook-calm', 'hook-aggressive'] as const;

function pairSlots(pairs: number, status = 'published'): ExperimentSlotFact[] {
  const slots: ExperimentSlotFact[] = [];
  for (let pair = 1; pair <= pairs; pair += 1) {
    for (const variantId of VARIANTS) slots.push({ postId: `${variantId}-${pair}`, variantId, pair, status });
  }
  return slots;
}

function metric(postId: string, provider: string, views: number | null, extra: Partial<ExperimentMetricFact> = {}): ExperimentMetricFact {
  return { postId, provider, views, likes: null, comments: null, averageViewDurationSeconds: null, ...extra };
}

/** One YouTube metric per video; `aggressiveWins` pairs go to the aggressive hook. */
function youtubeMetrics(pairs: number, aggressiveWins: number): ExperimentMetricFact[] {
  const rows: ExperimentMetricFact[] = [];
  for (let pair = 1; pair <= pairs; pair += 1) {
    const aggressiveAhead = pair <= aggressiveWins;
    rows.push(metric(`hook-calm-${pair}`, 'youtube', aggressiveAhead ? 100 : 200));
    rows.push(metric(`hook-aggressive-${pair}`, 'youtube', aggressiveAhead ? 200 : 100));
  }
  return rows;
}

describe('signTestPValue', () => {
  it('matches the exact binomial values', () => {
    expect(signTestPValue(4, 0)).toBeCloseTo(0.125, 10);
    expect(signTestPValue(3, 1)).toBeCloseTo(0.625, 10);
    expect(signTestPValue(6, 0)).toBeCloseTo(0.03125, 10);
    expect(signTestPValue(0, 6)).toBeCloseTo(0.03125, 10);
    expect(signTestPValue(5, 1)).toBeCloseTo(0.21875, 10);
    expect(signTestPValue(2, 2)).toBe(1);
    expect(signTestPValue(0, 0)).toBe(1);
  });
});

describe('computeExperimentResults', () => {
  it('is clear only when every target pair is decided and p < 0.05', () => {
    const result = computeExperimentResults({
      variantIds: VARIANTS,
      targetPairs: 6,
      slots: pairSlots(6),
      metrics: youtubeMetrics(6, 6),
    });
    const youtube = result.providers[0];
    expect(youtube.provider).toBe('youtube');
    expect(youtube.wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 6 });
    expect(youtube.pValue).toBeLessThan(CLEAR_P_VALUE);
    expect(youtube.leader).toBe('hook-aggressive');
    expect(youtube.label).toBe('clear');
    expect(result.pairsCreated).toBe(6);
    expect(result.pairsPublished).toBe(6);
  });

  it('4 of 4 is only indicative (p = 0.125), never a winner', () => {
    const youtube = computeExperimentResults({
      variantIds: VARIANTS,
      targetPairs: 4,
      slots: pairSlots(4),
      metrics: youtubeMetrics(4, 4),
    }).providers[0];
    expect(youtube.pValue).toBeCloseTo(0.125, 10);
    expect(youtube.label).toBe('indicative');
  });

  it('a lopsided partial result stays indicative until all target pairs are in', () => {
    const youtube = computeExperimentResults({
      variantIds: VARIANTS,
      targetPairs: 10,
      slots: pairSlots(6),
      metrics: youtubeMetrics(6, 6),
    }).providers[0];
    expect(youtube.pValue).toBeLessThan(CLEAR_P_VALUE);
    expect(youtube.label).toBe('indicative');
  });

  it('a tied pair is not decided: 19 wins + 1 tie of 20 target pairs stays indicative', () => {
    const metrics = youtubeMetrics(20, 19);
    metrics[38] = metric('hook-calm-20', 'youtube', 150);
    metrics[39] = metric('hook-aggressive-20', 'youtube', 150);
    const youtube = computeExperimentResults({ variantIds: VARIANTS, targetPairs: 20, slots: pairSlots(20), metrics }).providers[0];
    expect(youtube.comparisons).toHaveLength(20);
    expect(youtube.ties).toBe(1);
    expect(youtube.wins['hook-aggressive']).toBe(19);
    expect(youtube.pValue).toBeLessThan(CLEAR_P_VALUE);
    expect(youtube.label).toBe('indicative');
  });

  it('compares per provider and never mixes networks', () => {
    const metrics = [
      ...youtubeMetrics(3, 3),
      metric('hook-calm-1', 'bluesky', 50),
      metric('hook-aggressive-1', 'bluesky', 10),
    ];
    const result = computeExperimentResults({ variantIds: VARIANTS, targetPairs: 3, slots: pairSlots(3), metrics });
    expect(result.providers.map((p) => p.provider)).toEqual(['bluesky', 'youtube']);
    expect(result.providers[0].wins).toEqual({ 'hook-calm': 1, 'hook-aggressive': 0 });
    expect(result.providers[1].wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 3 });
  });

  it('sums a video across accounts of one provider and averages its view duration', () => {
    const metrics = [
      metric('hook-calm-1', 'youtube', 100, { averageViewDurationSeconds: 10 }),
      metric('hook-calm-1', 'youtube', 50, { averageViewDurationSeconds: 20 }),
      metric('hook-aggressive-1', 'youtube', 120, { averageViewDurationSeconds: null }),
    ];
    const comparison = computeExperimentResults({
      variantIds: VARIANTS,
      targetPairs: 3,
      slots: pairSlots(1),
      metrics,
    }).providers[0].comparisons[0];
    expect(comparison.values['hook-calm']).toEqual({ views: 150, likes: null, comments: null, averageViewDurationSeconds: 15 });
    expect(comparison.values['hook-aggressive'].averageViewDurationSeconds).toBeNull();
    expect(comparison.winner).toBe('hook-calm');
  });

  it('skips a half pair, a missing metric and unknown views; counts ties apart', () => {
    const slots = [...pairSlots(3), { postId: 'hook-calm-4', variantId: 'hook-calm', pair: 4, status: 'published' }];
    const metrics = [
      metric('hook-calm-1', 'youtube', 100),
      metric('hook-aggressive-1', 'youtube', 100),
      metric('hook-calm-2', 'youtube', 100),
      metric('hook-calm-3', 'youtube', 80),
      metric('hook-aggressive-3', 'youtube', null),
      metric('hook-calm-4', 'youtube', 999),
    ];
    const result = computeExperimentResults({ variantIds: VARIANTS, targetPairs: 4, slots, metrics });
    const youtube = result.providers[0];
    expect(result.pairsCreated).toBe(3);
    expect(youtube.comparisons.map((c) => c.pair)).toEqual([1]);
    expect(youtube.ties).toBe(1);
    expect(youtube.pValue).toBeNull();
    expect(youtube.leader).toBeNull();
    expect(youtube.label).toBe('pending');
  });

  it('counts a pair as published only when both videos are', () => {
    const slots = pairSlots(2);
    slots[3] = { ...slots[3], status: 'pending' };
    const result = computeExperimentResults({ variantIds: VARIANTS, targetPairs: 3, slots, metrics: [] });
    expect(result.pairsCreated).toBe(2);
    expect(result.pairsPublished).toBe(1);
    expect(result.providers).toEqual([]);
  });
});
