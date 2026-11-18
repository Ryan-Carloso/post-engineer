'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import type { PostJoins } from './post-joins';

//---------------
// Persona filter behind the /posts sidebar ("Os meus calendários"): one
// row per persona the account's schedules use, plus one row for the
// faceless posts (schedules without a persona). Toggling a row off hides
// that persona's slots from the grid and the day list; the network and
// account filters keep applying on top.
//---------------

// One swatch per persona, assigned by row order (alphabetical rank): the
// palette is fixed, but a persona's swatch shifts when a persona that
// sorts before it is added or removed.
export const PERSONA_CALENDAR_COLORS = [
  '#22c55e',
  '#f59e0b',
  '#a78bfa',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#84cc16',
];

// Faceless posts have no persona to colour: their row is gray.
export const FACELESS_CALENDAR_COLOR = '#94a3b8';

// One row of "Os meus calendários". `id` is null for the faceless row.
export interface PersonaCalendar {
  id: string | null;
  name: string;
  color: string;
}

// The personas the schedules use, named and sorted for the sidebar: named
// personas first (alphabetical), the faceless row last. A persona the list
// no longer knows (deleted after its schedules were made) keeps its row
// under the fallback label instead of vanishing with its posts.
export function derivePersonaCalendars(
  schedules: ScheduleConfig[],
  personaNameById: Map<string, string>,
  noPersonaLabel: string,
  personaFallbackLabel: string,
): PersonaCalendar[] {
  const ids = new Set<string>();
  let hasFaceless = false;
  for (const schedule of schedules) {
    if (schedule.personaId === null) {
      hasFaceless = true;
    } else {
      ids.add(schedule.personaId);
    }
  }
  const named = [...ids]
    .map((id) => ({ id, name: personaNameById.get(id) ?? personaFallbackLabel }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const calendars: PersonaCalendar[] = named.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    color: PERSONA_CALENDAR_COLORS[index % PERSONA_CALENDAR_COLORS.length],
  }));
  if (hasFaceless) {
    calendars.push({ id: null, name: noPersonaLabel, color: FACELESS_CALENDAR_COLOR });
  }
  return calendars;
}

export interface PersonaFilter {
  calendars: PersonaCalendar[];
  hiddenIds: ReadonlySet<string | null>;
  togglePersona: (id: string | null) => void;
  passes: (slot: ScheduledSlot) => boolean;
  hasActiveFilter: boolean;
  clear: () => void;
}

// Toggle state for the sidebar rows. All rows start visible; a hidden row
// stays hidden until toggled back or cleared. Slots whose schedule was
// deleted never pass, like the network/account filters.
export function usePersonaFilter(
  joins: Pick<PostJoins, 'scheduleById' | 'personaNameById'>,
  noPersonaLabel: string,
  personaFallbackLabel: string,
): PersonaFilter {
  const calendars = useMemo(
    () =>
      derivePersonaCalendars(
        [...joins.scheduleById.values()],
        joins.personaNameById,
        noPersonaLabel,
        personaFallbackLabel,
      ),
    [joins.scheduleById, joins.personaNameById, noPersonaLabel, personaFallbackLabel],
  );
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string | null>>(new Set());
  const togglePersona = useCallback((id: string | null) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const passes = useCallback(
    (slot: ScheduledSlot) => {
      const schedule = joins.scheduleById.get(slot.scheduleId);
      if (!schedule) return false;
      return !hiddenIds.has(schedule.personaId);
    },
    [joins.scheduleById, hiddenIds],
  );
  const clear = useCallback(() => setHiddenIds(new Set()), []);
  return { calendars, hiddenIds, togglePersona, passes, hasActiveFilter: hiddenIds.size > 0, clear };
}
