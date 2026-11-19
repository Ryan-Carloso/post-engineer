import { isSocialProvider } from '@/lib/providers/registry';
import type { ExperimentResultLabel, ExperimentResults } from './results';

export interface ExperimentResultsTelemetry {
  pairs_created: number;
  pairs_published: number;
  labels: Record<string, ExperimentResultLabel>;
  [key: string]: unknown;
}

function isResultLabel(value: string): value is ExperimentResultLabel {
  return value === 'pending' || value === 'indicative' || value === 'clear';
}

export function experimentResultsTelemetry(results: ExperimentResults): ExperimentResultsTelemetry {
  const labels: Record<string, ExperimentResultLabel> = {};
  for (const provider of results.providers) {
    if (!isSocialProvider(provider.provider) || !isResultLabel(provider.label)) continue;
    labels[provider.provider] = provider.label;
  }
  return {
    pairs_created: results.pairsCreated,
    pairs_published: results.pairsPublished,
    labels,
  };
}
