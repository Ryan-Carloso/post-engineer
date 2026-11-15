// Thin re-export of the shared experiments contract (issue #476). The
// single source of truth is shared/contracts/experiments.ts (synced to
// apps/web/lib/contracts/experiments.ts by scripts/sync-contracts.mjs).
// Existing importers keep importing from this path.
export {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIABLES,
  EXPERIMENT_VARIANT_COUNT,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from '@/lib/contracts/experiments';
export type { ExperimentVariable } from '@/lib/contracts/experiments';
