// Thin re-export of the shared experiments contract (issue #476). The
// single source of truth is shared/contracts/experiments.ts (synced to
// apps/web/lib/contracts/experiments.ts by scripts/sync-contracts.mjs).
// Existing importers keep importing from this path.
export {
  CreateExperimentSchema,
  DEFAULT_RESULTS_WINDOW,
  parseExperimentDetailQuery,
  parseResultsWindow,
} from '@/lib/contracts/experiments';
export type { CreateExperimentInput, ExperimentDetailQuery, MetricsWindow } from '@/lib/contracts/experiments';
export { createExperiment, getExperimentResults, listExperiments } from '@/lib/contracts/experiments';
