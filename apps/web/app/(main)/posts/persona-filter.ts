'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import type { PostJoins } from './post-joins';

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

export const FACELESS_CALENDAR_COLOR = '#94a3b8';

export interface PersonaCalendar {
  id: string | null;
  name: string;
  color: string;
}

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
