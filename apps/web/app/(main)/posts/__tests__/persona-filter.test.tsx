import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import {
  derivePersonaCalendars,
  usePersonaFilter,
  FACELESS_CALENDAR_COLOR,
  PERSONA_CALENDAR_COLORS,
  type PersonaCalendar,
} from '../persona-filter';

//---------------
// Tests for the persona filter behind the /posts sidebar ("Os meus
// calendários"): which persona rows the sidebar shows, and which slots
// stay visible when a row is toggled off.
//---------------

function schedule(id: string, personaId: string | null): ScheduleConfig {
  return {
    id,
    personaId,
    providers: ['youtube'],
    youtubeAccountIds: [],
    instagramAccountIds: [],
    linkedinAccountIds: [],
    blueskyAccountIds: [],
    threadsAccountIds: [],
    facebookAccountIds: [],
    pinterestAccountIds: [],
    pinterestBoardId: null,
    threespeakAccountIds: [],
    rumbleAccountIds: [],
    fanvueAccountIds: [],
    daysOfWeek: [1],
    startHour: 9,
    endHour: 17,
    postsPerDay: 1,
    timezone: 'UTC',
    active: true,
    publishMode: 'scheduled',
  };
}

function slot(id: string, scheduleId: string): ScheduledSlot {
  return {
    id,
    scheduleId,
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'awaiting',
    title: 'Topic',
    error: null,
    publishedAt: null,
    progress: 0,
    stage: null,
    queuePosition: null,
    queueTotal: null,
    retryable: null,
  };
}

const NO_PERSONA = 'No persona';
const FALLBACK = 'Removed persona';

describe('derivePersonaCalendars', () => {
  it('collects distinct personas from schedules, sorted by name, with palette colors in order', () => {
    const schedules = [schedule('s1', 'p2'), schedule('s2', 'p1'), schedule('s3', 'p2')];
    const names = new Map([
      ['p1', 'HabitLoom'],
      ['p2', 'Daily Dose'],
    ]);
    const calendars = derivePersonaCalendars(schedules, names, NO_PERSONA, FALLBACK);
    expect(calendars).toEqual([
      { id: 'p2', name: 'Daily Dose', color: PERSONA_CALENDAR_COLORS[0] },
      { id: 'p1', name: 'HabitLoom', color: PERSONA_CALENDAR_COLORS[1] },
    ] satisfies PersonaCalendar[]);
  });

  it('adds a faceless row last when a schedule has no persona', () => {
    const schedules = [schedule('s1', 'p1'), schedule('s2', null)];
    const calendars = derivePersonaCalendars(schedules, new Map([['p1', 'HabitLoom']]), NO_PERSONA, FALLBACK);
    expect(calendars).toEqual([
      { id: 'p1', name: 'HabitLoom', color: PERSONA_CALENDAR_COLORS[0] },
      { id: null, name: NO_PERSONA, color: FACELESS_CALENDAR_COLOR },
    ] satisfies PersonaCalendar[]);
  });

  it('has no faceless row when every schedule has a persona', () => {
    const calendars = derivePersonaCalendars(
      [schedule('s1', 'p1')],
      new Map([['p1', 'HabitLoom']]),
      NO_PERSONA,
      FALLBACK,
    );
    expect(calendars).toHaveLength(1);
    expect(calendars[0]?.id).toBe('p1');
  });

  it('names a persona the list no longer knows with the fallback label', () => {
    const calendars = derivePersonaCalendars([schedule('s1', 'p9')], new Map(), NO_PERSONA, FALLBACK);
    expect(calendars).toEqual([{ id: 'p9', name: FALLBACK, color: PERSONA_CALENDAR_COLORS[0] }]);
  });

  it('returns no rows when there are no schedules', () => {
    expect(derivePersonaCalendars([], new Map(), NO_PERSONA, FALLBACK)).toEqual([]);
  });
});

describe('usePersonaFilter', () => {
  function setup() {
    const joins = {
      scheduleById: new Map([
        ['s1', schedule('s1', 'p1')],
        ['s2', schedule('s2', 'p2')],
        ['s3', schedule('s3', null)],
      ]),
      personaNameById: new Map([
        ['p1', 'HabitLoom'],
        ['p2', 'Daily Dose'],
      ]),
    };
    let latest: ReturnType<typeof usePersonaFilter> | undefined;
    function Probe() {
      latest = usePersonaFilter(joins, NO_PERSONA, FALLBACK);
      return null;
    }
    render(<Probe />);
    const hook = () => {
      if (!latest) throw new Error('hook never rendered');
      return latest;
    };
    return { hook };
  }

  it('shows every slot while nothing is toggled off', () => {
    const { hook } = setup();
    expect(hook().hasActiveFilter).toBe(false);
    expect(hook().passes(slot('a', 's1'))).toBe(true);
    expect(hook().passes(slot('b', 's2'))).toBe(true);
    expect(hook().passes(slot('c', 's3'))).toBe(true);
  });

  it('hides only the toggled persona’s slots', () => {
    const { hook } = setup();
    act(() => {
      hook().togglePersona('p1');
    });
    expect(hook().hasActiveFilter).toBe(true);
    expect(hook().passes(slot('a', 's1'))).toBe(false);
    expect(hook().passes(slot('b', 's2'))).toBe(true);
    expect(hook().passes(slot('c', 's3'))).toBe(true);
  });

  it('hides the faceless slots when the faceless row is toggled off', () => {
    const { hook } = setup();
    act(() => {
      hook().togglePersona(null);
    });
    expect(hook().passes(slot('a', 's1'))).toBe(true);
    expect(hook().passes(slot('c', 's3'))).toBe(false);
  });

  it('toggling twice restores the persona', () => {
    const { hook } = setup();
    act(() => {
      hook().togglePersona('p1');
    });
    act(() => {
      hook().togglePersona('p1');
    });
    expect(hook().hasActiveFilter).toBe(false);
    expect(hook().passes(slot('a', 's1'))).toBe(true);
  });

  it('clear restores every persona', () => {
    const { hook } = setup();
    act(() => {
      hook().togglePersona('p1');
      hook().togglePersona('p2');
    });
    act(() => {
      hook().clear();
    });
    expect(hook().hasActiveFilter).toBe(false);
    expect(hook().passes(slot('a', 's1'))).toBe(true);
    expect(hook().passes(slot('b', 's2'))).toBe(true);
  });

  it('never passes a slot whose schedule was deleted', () => {
    const { hook } = setup();
    expect(hook().passes(slot('x', 'gone'))).toBe(false);
  });
});
