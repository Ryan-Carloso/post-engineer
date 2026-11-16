import { describe, expect, it } from 'vitest';
import { experimentResultsTelemetry } from '@/lib/experiments/results-telemetry';
import type { ExperimentResults, ProviderResult } from '@/lib/experiments/results';

function provider(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    provider: 'youtube',
    comparisons: [],
    wins: { 'hook-calm': 3, 'hook-aggressive': 0 },
    ties: 0,
    pValue: 0.25,
    leader: 'hook-calm',
    label: 'indicative',
    ...overrides,
  };
}

function results(overrides: Partial<ExperimentResults> = {}): ExperimentResults {
  return {
    targetPairs: 6,
    pairsCreated: 2,
    pairsPublished: 1,
    providers: [provider(), provider({ provider: 'bluesky', label: 'pending', leader: null, pValue: null, wins: {} })],
    ...overrides,
  };
}

describe('experimentResultsTelemetry', () => {
  it('carries pair counts and the label code per provider code', () => {
    expect(experimentResultsTelemetry(results())).toEqual({
      pairs_created: 2,
      pairs_published: 1,
      labels: { youtube: 'indicative', bluesky: 'pending' },
    });
  });

  it('drops a provider that is not a provider code and a label that is not a label code', () => {
    const value = experimentResultsTelemetry(results({
      providers: [
        { ...provider(), provider: 'sk-live-secret-provider-value' },
        { ...provider(), label: 'won' },
      ] as ProviderResult[],
    }));
    expect(value.labels).toEqual({});
    expect(JSON.stringify(value)).not.toContain('secret-provider');
    expect(JSON.stringify(value)).not.toContain('hook-calm');
    expect(JSON.stringify(value)).not.toContain('won');
  });
});
