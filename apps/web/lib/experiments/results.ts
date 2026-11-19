export const CLEAR_P_VALUE = 0.05;

export type ExperimentResultLabel = 'pending' | 'indicative' | 'clear';

export interface ExperimentSlotFact {
  postId: string;
  variantId: string;
  pair: number;
  status: string;
}

export interface ExperimentMetricFact {
  postId: string;
  provider: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  averageViewDurationSeconds: number | null;
}

export interface VariantTotals {
  views: number | null;
  likes: number | null;
  comments: number | null;
  averageViewDurationSeconds: number | null;
}

export interface PairComparison {
  pair: number;
  values: Record<string, VariantTotals>;
  winner: string | null;
}

export interface ProviderResult {
  provider: string;
  comparisons: PairComparison[];
  wins: Record<string, number>;
  ties: number;
  pValue: number | null;
  leader: string | null;
  label: ExperimentResultLabel;
}

export interface ExperimentResults {
  targetPairs: number;
  pairsCreated: number;
  pairsPublished: number;
  providers: ProviderResult[];
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

export function signTestPValue(winsA: number, winsB: number): number {
  const n = winsA + winsB;
  if (n === 0) return 1;
  const k = Math.min(winsA, winsB);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += binomial(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

function meanOrNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0) / present.length;
}

function totalsFor(rows: ExperimentMetricFact[]): VariantTotals {
  return {
    views: sumOrNull(rows.map((row) => row.views)),
    likes: sumOrNull(rows.map((row) => row.likes)),
    comments: sumOrNull(rows.map((row) => row.comments)),
    averageViewDurationSeconds: meanOrNull(rows.map((row) => row.averageViewDurationSeconds)),
  };
}

function providerResult(
  provider: string,
  variantIds: readonly [string, string],
  targetPairs: number,
  pairSlots: Map<number, Map<string, string>>,
  metrics: ExperimentMetricFact[],
): ProviderResult {
  const [first, second] = variantIds;
  const comparisons: PairComparison[] = [];
  const wins: Record<string, number> = { [first]: 0, [second]: 0 };
  let ties = 0;
  for (const [pair, slots] of [...pairSlots.entries()].sort((a, b) => a[0] - b[0])) {
    const values: Record<string, VariantTotals> = {};
    for (const variantId of variantIds) {
      const postId = slots.get(variantId);
      const rows = metrics.filter((row) => row.provider === provider && row.postId === postId);
      if (postId === undefined || rows.length === 0) continue;
      values[variantId] = totalsFor(rows);
    }
    const viewsA = values[first]?.views ?? null;
    const viewsB = values[second]?.views ?? null;
    if (viewsA === null || viewsB === null) continue;
    const winner = viewsA === viewsB ? null : viewsA > viewsB ? first : second;
    if (winner === null) ties += 1;
    else wins[winner] += 1;
    comparisons.push({ pair, values, winner });
  }
  const decided = wins[first] + wins[second];
  const pValue = decided === 0 ? null : signTestPValue(wins[first], wins[second]);
  const leader = wins[first] === wins[second] ? null : wins[first] > wins[second] ? first : second;
  const complete = decided >= targetPairs;
  const label: ExperimentResultLabel =
    pValue === null ? 'pending' : complete && pValue < CLEAR_P_VALUE ? 'clear' : 'indicative';
  return { provider, comparisons, wins, ties, pValue, leader, label };
}

export function computeExperimentResults(input: {
  variantIds: readonly [string, string];
  targetPairs: number;
  slots: ExperimentSlotFact[];
  metrics: ExperimentMetricFact[];
}): ExperimentResults {
  const byPair = new Map<number, Map<string, string>>();
  const statusByPost = new Map<string, string>();
  for (const slot of input.slots) {
    const entry = byPair.get(slot.pair) ?? new Map<string, string>();
    entry.set(slot.variantId, slot.postId);
    byPair.set(slot.pair, entry);
    statusByPost.set(slot.postId, slot.status);
  }
  const fullPairs = new Map(
    [...byPair.entries()].filter(([, slots]) => input.variantIds.every((variantId) => slots.has(variantId))),
  );
  const pairsPublished = [...fullPairs.values()].filter((slots) =>
    [...slots.values()].every((postId) => statusByPost.get(postId) === 'published'),
  ).length;
  const providers = [...new Set(input.metrics.map((row) => row.provider))].sort();
  return {
    targetPairs: input.targetPairs,
    pairsCreated: fullPairs.size,
    pairsPublished,
    providers: providers.map((provider) =>
      providerResult(provider, input.variantIds, input.targetPairs, fullPairs, input.metrics),
    ),
  };
}
