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

  // Each case breaks exactly one validator conjunct in the experiment shape.
  it.each([
    ['a string targetPairs', (experiment: typeof EXPERIMENT) => { experiment.targetPairs = '3' as never; }],
    ['a numeric personaId', (experiment: typeof EXPERIMENT) => { experiment.personaId = 9 as never; }],
    ['a variant with a non-string name', (experiment: typeof EXPERIMENT) => { experiment.variants[0].name = 42 as never; }],
    ['variants that are not an array', (experiment: typeof EXPERIMENT) => { experiment.variants = 'x' as never; }],
  ])('rejects a list body with %s', async (_label, mutate) => {
    const experiment = JSON.parse(JSON.stringify(EXPERIMENT)) as typeof EXPERIMENT;
    mutate(experiment);
    mockFetch.mockResolvedValue(ok({ success: true, experiments: [experiment], truncated: false }));
    await expect(fetchExperiments()).resolves.toEqual({ success: false, error: 'unexpected response' });
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

  it('accepts a snapshot detail whose liveAt is null', async () => {
    mockFetch.mockResolvedValue(ok({ ...DETAIL, source: 'snapshot', liveAt: null }));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ ...DETAIL, source: 'snapshot', liveAt: null });
  });

  // Each case breaks exactly one validator conjunct, so a validator that
  // drops that check (or flips its && to ||) lets the body through.
  it.each([
    ['a variant with a non-string name', (body: typeof DETAIL) => { body.experiment.variants[0].name = 42 as never; }],
    ['a variant with a non-string description', (body: typeof DETAIL) => { body.experiment.variants[0].description = null as never; }],
    ['a variant with a non-string variantId', (body: typeof DETAIL) => { body.experiment.variants[0].variantId = 7 as never; }],
    ['variants that are not an array', (body: typeof DETAIL) => { body.experiment.variants = 'x' as never; }],
    ['an experiment with a non-string id', (body: typeof DETAIL) => { body.experiment.id = 1 as never; }],
    ['an experiment with a non-string name', (body: typeof DETAIL) => { body.experiment.name = null as never; }],
    ['an experiment with a non-string variable', (body: typeof DETAIL) => { body.experiment.variable = 3 as never; }],
    ['an experiment with a non-string createdAt', (body: typeof DETAIL) => { body.experiment.createdAt = 0 as never; }],
    ['an experiment with a string targetPairs', (body: typeof DETAIL) => { body.experiment.targetPairs = '3' as never; }],
    ['an experiment with a numeric personaId', (body: typeof DETAIL) => { body.experiment.personaId = 9 as never; }],
    ['a 28d window', (body: typeof DETAIL) => { body.window = '28d' as never; }],
    ['videos that are not an array', (body: typeof DETAIL) => { body.videos = {} as never; }],
    ['a string truncated flag', (body: typeof DETAIL) => { body.truncated = 'no' as never; }],
    ['an unknown source', (body: typeof DETAIL) => { body.source = 'bogus' as never; }],
    ['a numeric liveAt', (body: typeof DETAIL) => { body.liveAt = 12 as never; }],
    ['a string frozen flag', (body: typeof DETAIL) => { body.frozen = 'yes' as never; }],
    ['liveFailures that are not an array', (body: typeof DETAIL) => { body.liveFailures = 'none' as never; }],
    ['a string results targetPairs', (body: typeof DETAIL) => { body.results.targetPairs = '3' as never; }],
    ['providers that are not an array', (body: typeof DETAIL) => { body.results.providers = null as never; }],
    ['a provider with a string pValue', (body: typeof DETAIL) => { body.results.providers[0].pValue = '0.25' as never; }],
    ['a provider with a numeric leader', (body: typeof DETAIL) => { body.results.providers[0].leader = 1 as never; }],
    ['a provider with string ties', (body: typeof DETAIL) => { body.results.providers[0].ties = '0' as never; }],
    ['provider comparisons that are not an array', (body: typeof DETAIL) => { body.results.providers[0].comparisons = {} as never; }],
    ['a provider with a non-string provider id', (body: typeof DETAIL) => { body.results.providers[0].provider = 5 as never; }],
  ])('rejects a detail body with %s', async (_label, mutate) => {
    const body = JSON.parse(JSON.stringify(DETAIL)) as typeof DETAIL;
    mutate(body);
    mockFetch.mockResolvedValue(ok(body));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ success: false, error: 'unexpected response' });
  });

  it('rejects an unparseable body and reports a failed fetch', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ success: false, error: 'unexpected response' });
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(fetchExperimentDetail(EXPERIMENT.id, '7d')).resolves.toEqual({ success: false, error: 'offline' });
  });
});
