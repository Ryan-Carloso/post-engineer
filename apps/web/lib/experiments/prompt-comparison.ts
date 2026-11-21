import type { PromptVersionSource } from '@/lib/contracts/experiments';

export const MIN_COMPARED_VIDEOS = 5;
export const CLEAR_P_VALUE = 0.05;
export const INDICATIVE_P_VALUE = 0.2;

export type ComparisonLabel = 'insufficient' | 'no_signal' | 'indicative' | 'clear';
export type ComparisonDirection = 'above' | 'below';
export type { PromptVersionSource };

export interface ComparedVideo {
  provider: string;
  accountId: string;
  views: number;
  promptVersionId: string | null;
}

export interface PromptVersionFacts {
  versionId: string;
  slug: string;
  title: string;
  version: number;
  source: PromptVersionSource;
}

export interface PromptResult {
  versionId: string | null;
  slug: string | null;
  title: string | null;
  version: number | null;
  source: PromptVersionSource | null;
  videos: number;
  medianViews: number | null;
  lift: number | null;
  pValue: number | null;
  label: ComparisonLabel;
  direction: ComparisonDirection | null;
}

export interface AccountResult {
  provider: string;
  accountId: string;
  videos: number;
  baselineViews: number | null;
  prompts: PromptResult[];
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

export function signTestPValue(above: number, below: number): number {
  const n = above + below;
  if (n === 0) return 1;
  const k = Math.min(above, below);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += binomial(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function liftOf(videos: ComparedVideo[], index: number): number | null {
  const others = videos.filter((_, other) => other !== index).map((video) => video.views);
  const baseline = median(others);
  if (baseline === null || baseline === 0) return null;
  return videos[index].views / baseline;
}

function labelFor(compared: number, pValue: number): ComparisonLabel {
  if (compared < MIN_COMPARED_VIDEOS) return 'insufficient';
  if (pValue < CLEAR_P_VALUE) return 'clear';
  if (pValue < INDICATIVE_P_VALUE) return 'indicative';
  return 'no_signal';
}

function promptResult(versionId: string | null, facts: PromptVersionFacts | undefined, views: number[], lifts: number[]): PromptResult {
  const above = lifts.filter((lift) => lift > 1).length;
  const below = lifts.filter((lift) => lift < 1).length;
  const pValue = lifts.length === 0 ? null : signTestPValue(above, below);
  const lift = median(lifts);
  return {
    versionId,
    slug: facts?.slug ?? null,
    title: facts?.title ?? null,
    version: facts?.version ?? null,
    source: facts?.source ?? null,
    videos: views.length,
    medianViews: median(views),
    lift,
    pValue,
    label: pValue === null ? 'insufficient' : labelFor(lifts.length, pValue),
    direction: lift === null || lift === 1 ? null : lift > 1 ? 'above' : 'below',
  };
}

function compareAccount(provider: string, accountId: string, videos: ComparedVideo[], versions: Map<string, PromptVersionFacts>): AccountResult {
  const groups = new Map<string | null, { views: number[]; lifts: number[] }>();
  videos.forEach((video, index) => {
    const group = groups.get(video.promptVersionId) ?? { views: [], lifts: [] };
    group.views.push(video.views);
    const lift = liftOf(videos, index);
    if (lift !== null) group.lifts.push(lift);
    groups.set(video.promptVersionId, group);
  });
  const prompts = [...groups.entries()]
    .map(([versionId, group]) => promptResult(versionId, versionId === null ? undefined : versions.get(versionId), group.views, group.lifts))
    .sort((left, right) => {
      if ((left.versionId === null) !== (right.versionId === null)) return left.versionId === null ? 1 : -1;
      return right.videos - left.videos || String(left.versionId).localeCompare(String(right.versionId));
    });
  return { provider, accountId, videos: videos.length, baselineViews: median(videos.map((video) => video.views)), prompts };
}

export function comparePrompts(videos: ComparedVideo[], versions: PromptVersionFacts[]): AccountResult[] {
  const byVersion = new Map(versions.map((facts) => [facts.versionId, facts]));
  const accounts = new Map<string, { provider: string; accountId: string; videos: ComparedVideo[] }>();
  for (const video of videos) {
    const key = `${video.provider}\u0000${video.accountId}`;
    const account = accounts.get(key) ?? { provider: video.provider, accountId: video.accountId, videos: [] };
    account.videos.push(video);
    accounts.set(key, account);
  }
  return [...accounts.values()]
    .filter((account) => account.videos.some((video) => video.promptVersionId !== null))
    .map((account) => compareAccount(account.provider, account.accountId, account.videos, byVersion))
    .sort((left, right) => right.videos - left.videos || left.provider.localeCompare(right.provider) || left.accountId.localeCompare(right.accountId));
}
