const UNIQUE_VIOLATION_SQLSTATE = '23505';

export const SCHEDULE_PK_CONSTRAINT = 'schedules_pkey';

export const SCHEDULES_PERSONA_OWNER_CONSTRAINT = 'schedules_persona_owner';

export function violatedConstraint(
  error: { code?: string; message?: string; details?: string } | null | undefined
): string | null {
  if (error?.code !== UNIQUE_VIOLATION_SQLSTATE) return null;
  const source = `${error.message ?? ''} ${error.details ?? ''}`;
  return /constraint "([^"]+)"/.exec(source)?.[1] ?? null;
}
