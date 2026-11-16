import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isScopedApiKey, type PersonaScopeContext } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { UUID } from '@/lib/metrics/metrics-query';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// video-task-scope — which persona owns an engine task, and whether a
// persona-scoped API key may read it.
//
// The service client bypasses RLS, so every lookup filters by user_id.
// A generation row wins over a scheduled slot: video_generations.persona_id
// is stored at dispatch, and a null there is a persona-less (faceless)
// generation, not an orphan of a deleted schedule. Slot orphans are
// resolved through scheduled_posts.faceless (literal true only) and the
// schedule row. A deleted schedule does not make the post faceless.
//
// DELETE stays fail-closed: a missing schedule is not found, and a null
// persona is allowed. Reads hide a null persona unless the post is
// faceless, and answer 404 (the same as unknown) when it is out of scope.
//---------------

export interface TaskScope {
  found: boolean;
  personaId: string | null;
  faceless: boolean;
  scheduleMissing: boolean;
}

const NOT_FOUND: TaskScope = {
  found: false,
  personaId: null,
  faceless: false,
  scheduleMissing: false,
};

export type GenerationPersonaFilter = { kind: 'null' } | { kind: 'or'; filter: string };

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function field(row: unknown, key: string): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  return Reflect.get(row, key);
}

// Persona ids are only string-checked at key creation. Drop anything that
// is not a UUID before interpolating it into a PostgREST filter.
export function generationPersonaOrFilter(personaIds: readonly string[]): GenerationPersonaFilter {
  const ids = personaIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return { kind: 'null' };
  return { kind: 'or', filter: `persona_id.in.(${ids.join(',')}),persona_id.is.null` };
}

export async function resolveTaskScope(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<TaskScope> {
  const { data: generation, error: generationError } = await supabase
    .from('video_generations')
    .select('persona_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (generationError) throw generationError;
  if (generation !== null) {
    const personaId = stringOrNull(field(generation, 'persona_id'));
    return {
      found: true,
      personaId,
      faceless: personaId === null,
      scheduleMissing: false,
    };
  }

  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('schedule_id, faceless')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (slotError) throw slotError;
  if (slot === null) return NOT_FOUND;

  const faceless = field(slot, 'faceless') === true;
  const scheduleId = stringOrNull(field(slot, 'schedule_id'));
  if (scheduleId === null) {
    return { found: true, personaId: null, faceless, scheduleMissing: false };
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('persona_id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  if (schedule === null) {
    return { found: true, personaId: null, faceless, scheduleMissing: true };
  }
  return {
    found: true,
    personaId: stringOrNull(field(schedule, 'persona_id')),
    faceless,
    scheduleMissing: false,
  };
}

export function isTaskVisibleToScopedKey(scope: TaskScope, personaIds: readonly string[]): boolean {
  if (!scope.found) return false;
  if (scope.scheduleMissing) return scope.faceless === true;
  if (scope.personaId === null) return scope.faceless === true;
  return personaIds.includes(scope.personaId);
}

// Returns a 404/500 response when a scoped key must not continue, or null
// when the caller may talk to the engine. Unscoped keys and OAuth skip
// the lookup. The 404 matches the unknown-task answer for that route.
export async function enforceScopedTaskRead(
  auth: PersonaScopeContext & { userId: string },
  taskId: string,
  route: string,
  notFoundMessage: string,
): Promise<NextResponse | null> {
  if (!isScopedApiKey(auth)) return null;
  try {
    const scope = await resolveTaskScope(createSupabaseServiceClient(), auth.userId, taskId);
    if (!isTaskVisibleToScopedKey(scope, auth.personaIds)) {
      return apiErrorResponse(404, notFoundMessage, { route });
    }
    return null;
  } catch (error) {
    logger.error('[video-task-scope] task scope lookup failed', error, { taskId, route });
    return apiErrorResponse(500, 'Failed to load video task.', { route, cause: error });
  }
}
