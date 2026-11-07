//---------------
// Content experiment limits (issue #476). Mirrors the CHECK constraints of
// supabase/migrations/041_experiments.sql; the sync test
// lib/__tests__/experiments-migration.test.ts compares each value with the
// migrated schema snapshot, so a one-sided change fails CI.
//---------------

/** Script variables an experiment may test. v1: the hook segment only. */
export const EXPERIMENT_VARIABLES = ['hook'] as const;
export type ExperimentVariable = (typeof EXPERIMENT_VARIABLES)[number];

/** Pairs per experiment: below 3 there is no signal at all. */
export const EXPERIMENT_TARGET_PAIRS_MIN = 3;
export const EXPERIMENT_TARGET_PAIRS_MAX = 20;

/** An experiment compares exactly two variants (positions 0 and 1). */
export const EXPERIMENT_VARIANT_COUNT = 2;

export const EXPERIMENT_NAME_MAX_LENGTH = 120;
export const EXPERIMENT_VARIANT_NAME_MAX_LENGTH = 80;
export const EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH = 500;

/** Variant slug, e.g. `hook-aggressive`. Never a visible "A"/"B" label. */
export const EXPERIMENT_VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
