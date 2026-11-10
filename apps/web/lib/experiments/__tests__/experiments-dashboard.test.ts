import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchExperimentDetail, fetchExperiments } from '../experiments-dashboard';

//---------------
// experiments-dashboard fetchers (issue #532). fetch is stubbed; the
// validators must reject a malformed body instead of rendering it.
//---------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const EXPERIMENT = {
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
};

const DETAIL = {
  success: true,
  experiment: EXPERIMENT,
  window: '7d',
  videos: [],
  results: {
    targetPairs: 3,
    pairsCreated: 3,
    pairsPublished: 3,
    providers: [
      {
        provider: 'youtube',
        comparisons: [
          { pair: 1, values: { 'hook-calm': { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 }, 'hook-aggressive': { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 } }, winner: 'hook-calm' },
        ],
        wins: { 'hook-calm': 3, 'hook-aggressive': 0 },
        ties: 0,
        pValue: 0.25,
        leader: 'hook-calm',
        label: 'indicative',
      },
    ],
  },
  truncated: false,
  source: 'live',
  liveAt: '2026-11-10T12:00:00.000Z',
  liveFailures: [],
  frozen: false,
};

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchExperiments', () => {
  it('returns the experiment list', async () => {
    mockFetch.mockResolvedValue(ok({ success: true, experiments: [EXPERIMENT], truncated: false }));
    await expect(fetchExperiments()).resolves.toEqual({ success: true, experiments: [EXPERIMENT], truncated: false });
    expect(mockFetch).toHaveBeenCalledWith('/api/experiments');
  });

  it('rejects a malformed list body and a failed fetch', async () => {
    mockFetch.mockResolvedValue(ok({ success: true, experiments: [{ id: 'x' }] }));
    await expect(fetchExperiments()).resolves.toEqual({ success: false, error: 'unexpected response' });
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(fetchExperiments()).resolves.toEqual({ success: false, error: 'offline' });
  });
});

describe('fetchExperimentDetail', () => {
  it('reads live results for the selected window', async () => {
    mockFetch.mockResolvedValue(ok(DETAIL));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '24h')).resolves.toEqual(DETAIL);
    expect(mockFetch).toHaveBeenCalledWith(`/api/experiments/${EXPERIMENT.id}?window=24h&live=1`);
  });

  it('rejects a snapshot-shaped body (no live fields) and a bad label', async () => {
    const { source, liveAt, liveFailures, frozen, ...snapshot } = DETAIL;
    void source; void liveAt; void liveFailures; void frozen;
    mockFetch.mockResolvedValue(ok(snapshot));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ success: false, error: 'unexpected response' });
    const badLabel = { ...DETAIL, results: { ...DETAIL.results, providers: [{ ...DETAIL.results.providers[0], label: 'won' }] } };
    mockFetch.mockResolvedValue(ok(badLabel));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ success: false, error: 'unexpected response' });
  });
});
