//---------------
// Unique-violation classification. Postgres reports SQLSTATE 23505 for EVERY
// unique constraint, and the two that can fire here mean opposite things:
//
//   schedules_pkey           — two concurrent requests derived the same
//                             deterministic schedule id; the loser must
//                             refund its own spend and replay the winner.
//   schedules_persona_owner — the persona already has a schedule row. That is
//                             NOT a concurrency race: it is the legacy
//                             one-schedule-per-persona constraint (still
//                             present on databases bootstrapped from the old
//                             apps/web/supabase chain, dropped for new ones by
//                             migration 011). Treating it as a race made this
//                             route refund a spend, then "replay" a schedule id
//                             that was never inserted — answering
//                             `{slots: [], replayed: true}`, i.e. reporting a
//                             success that generated nothing.
//
// So the constraint name is read from the error and classified, never assumed.
//---------------

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION_SQLSTATE = '23505';

/** Primary key of public.schedules: a genuine concurrent-duplicate race. */
export const SCHEDULE_PK_CONSTRAINT = 'schedules_pkey';

/**
 * Legacy one-schedule-per-persona constraint. Migration 011 drops it; until a
 * database applies that migration, every generation for a persona that already
 * has a schedule lands here.
 */
export const SCHEDULES_PERSONA_OWNER_CONSTRAINT = 'schedules_persona_owner';

/** The constraint a 23505 error names, or null when the error is not one. */
export function violatedConstraint(
  error: { code?: string; message?: string; details?: string } | null | undefined
): string | null {
  if (error?.code !== UNIQUE_VIOLATION_SQLSTATE) return null;
  const source = `${error.message ?? ''} ${error.details ?? ''}`;
  return /constraint "([^"]+)"/.exec(source)?.[1] ?? null;
}
