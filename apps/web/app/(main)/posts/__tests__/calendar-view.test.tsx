import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledSlot } from '@/lib/api';
const EN: Record<string, string> = {
  'posts.calendarPrevMonth': 'Previous month',
  'posts.calendarNextMonth': 'Next month',
  'posts.calendarToday': 'Today',
  'posts.groupPublished': 'Published',
  'posts.groupFailed': 'Failed',
  'posts.groupScheduled': 'Scheduled',
  'posts.calendarDayLabel': '{date}: {summary}',
  'posts.calendarDayEmpty': '{date}: no posts',
};

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string, vars: Record<string, string | number> = {}) =>
      Object.entries(vars).reduce((out, [name, value]) => out.split(`{${name}}`).join(String(value)), EN[key] ?? key),
  }),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/ui', () => ({
  ImageIcon: () => <span data-testid="icon-image" />,
}));

import { CalendarView } from '../calendar-view';
import type { PersonaPhoto } from '../calendar-days';

const SCHEDULES = new Map([
  ['s1', { personaId: 'p1' }],
  ['s2', { personaId: 'p2' }],
]);
const PHOTOS = new Map<string, PersonaPhoto>([
  ['p1', { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' }],
  ['p2', { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' }],
]);

type DaySlot = Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>;

function setup(overrides: Partial<React.ComponentProps<typeof CalendarView>> = {}) {
  const props = {
    year: 2030,
    month: 5,
    firstWeekday: 0 as const,
    slotsByDay: new Map<string, DaySlot[]>(),
    scheduleById: SCHEDULES,
    personaPhotoById: PHOTOS,
    selectedKey: null,
    todayKey: '2030-06-15',
    onSelect: vi.fn(),
    onMonthChange: vi.fn(),
    onMonthNavigate: vi.fn(),
    ...overrides,
  };
  render(<CalendarView {...(props as React.ComponentProps<typeof CalendarView>)} />);
  return props;
}

const dayButton = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name });

describe('CalendarView', () => {
  it('renders the month grid with localized weekday headers and the month caption', () => {
    setup();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { hidden: true })).toHaveLength(7);
    expect(screen.getAllByRole('columnheader', { hidden: true })[0]).toHaveAccessibleName(/Sunday/);
    expect(screen.getByText(/June 2030/)).toBeInTheDocument();
    // June 2030 starts on a Saturday: its days span 6 weeks.
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(6);
  });

  it('starts the week on Monday when asked', () => {
    setup({ firstWeekday: 1 });
    expect(screen.getAllByRole('columnheader', { hidden: true })[0]).toHaveAccessibleName(/Monday/);
  });

  it('marks today and the selected day', () => {
    setup({ selectedKey: '2030-06-20' });
    expect(dayButton(/June 15, 2030/).closest('[data-today]')).not.toBeNull();
    expect(dayButton(/June 20, 2030/).closest('[data-selected="true"]')).not.toBeNull();
    expect(dayButton(/June 21, 2030/).closest('[data-selected="true"]')).toBeNull();
  });

  it('draws today as a filled blue disc behind the day number, never as a cell border that reads like focus', () => {
    setup({ selectedKey: '2030-06-20' });
    const today = dayButton(/June 15, 2030/);
    const mark = today.querySelector('[data-today-mark="true"]');
    expect(mark).toHaveTextContent('15');
    expect(mark?.className.split(/\s+/)).toContain('bg-info');
    // No border frame on the cell and no accent fill that could read as selected.
    expect(today.className.split(/\s+/)).not.toContain('border-2');
    expect(today.className.split(/\s+/)).not.toContain('bg-accent');
    expect(today.closest('[data-today]')?.className.split(/\s+/)).not.toContain('bg-accent');
    // Only today carries the disc.
    expect(dayButton(/June 20, 2030/).querySelector('[data-today-mark]')).toBeNull();
  });

  it('keeps the today disc when today itself is selected, outlined in the card color against the selected fill', () => {
    setup({ selectedKey: '2030-06-15' });
    const mark = dayButton(/June 15, 2030/).querySelector('[data-today-mark="true"]');
    expect(mark?.className.split(/\s+/)).toEqual(expect.arrayContaining(['bg-info', 'border-2', 'border-card']));
  });

  it('dims the days outside the shown month', () => {
    setup();
    const grid = screen.getByRole('grid');
    const outside = within(grid)
      .getAllByRole('button')
      .find((button) => button.textContent === '1' && button.closest('[data-outside]') !== null);
    expect(outside?.className.split(/\s+/)).toContain('[&>span]:opacity-45');
    expect(outside?.querySelector('span')?.className.split(/\s+/)).toContain('font-normal');
    const inside = dayButton(/June 20, 2030/);
    expect(inside.className.split(/\s+/)).toContain('[&>span]:opacity-100');
    expect(inside.querySelector('span')?.className.split(/\s+/)).toContain('font-semibold');
  });

  it('describes per-group counts in the accessible name, failure first — never in progress', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T08:00:00.000Z' },
          { status: 'published', scheduleId: 's1', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T12:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T14:00:00.000Z' },
          { status: 'failed', scheduleId: 's2', slotAt: '2030-06-05T16:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    expect(cell).toHaveAccessibleName('Wednesday, June 5, 2030: Failed: 2, Published: 2, Scheduled: 1');
  });

  it('draws one status marker per group with its count, failure first, and tints a day with a failure', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T08:00:00.000Z' },
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's2', slotAt: '2030-06-05T11:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' },
        ],
      ],
      ['2030-06-06', [{ status: 'published', scheduleId: 's2', slotAt: '2030-06-06T10:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    const busy = dayButton(/June 5, 2030/);
    const markers = [...busy.querySelectorAll('[data-marker]')];
    expect(markers.map((marker) => marker.getAttribute('data-marker'))).toEqual(['failed', 'published', 'scheduled']);
    expect(markers.map((marker) => marker.textContent)).toEqual(['1', '1', '2']);
    expect(busy.className.split(/\s+/)).toContain('bg-destructive-soft');
    // A published-only day: one marker, no failure tint.
    const published = dayButton(/June 6, 2030/);
    expect([...published.querySelectorAll('[data-marker]')].map((marker) => marker.getAttribute('data-marker'))).toEqual([
      'published',
    ]);
    expect(published.className.split(/\s+/)).not.toContain('bg-destructive-soft');
  });

  it('keeps the selected fill on a selected day with a failure instead of the failure tint', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-05', [{ status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' }]],
    ]);
    setup({ slotsByDay, selectedKey: '2030-06-05' });
    const cell = dayButton(/June 5, 2030/);
    expect(cell.className.split(/\s+/)).not.toContain('bg-destructive-soft');
    expect(cell.querySelector('[data-marker="failed"]')).not.toBeNull();
  });

  it("shows the day's distinct personas, the failed post's first", () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T14:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    // The photos are aria-hidden (the day label carries the counts), so the
    // images are asserted by DOM, not by role.
    expect(cell.querySelector('[data-personas]')).toHaveAttribute('data-personas', '2');
    expect([...cell.querySelectorAll('[data-personas] img')].map((img) => img.getAttribute('alt'))).toEqual(['Viva Leve', 'Bicuda']);
  });

  it('still marks the status of a day whose posts resolve to no persona', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-09',
        [
          { status: 'awaiting', scheduleId: 's-gone', slotAt: '2030-06-09T10:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's-gone', slotAt: '2030-06-09T12:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 9, 2030/);
    expect(cell.querySelector('[data-personas]')).toBeNull();
    expect(cell.querySelector('[data-marker="scheduled"]')).toHaveTextContent('2');
  });

  it('names empty days explicitly and draws no marker or persona', () => {
    setup();
    const cell = dayButton(/June 9, 2030/);
    expect(cell).toHaveAccessibleName('Sunday, June 9, 2030: no posts');
    expect(cell.querySelector('[data-marker]')).toBeNull();
    expect(cell.querySelector('[data-personas]')).toBeNull();
  });

  it('legends the same markers the cells draw — failed, published, scheduled — plus today', () => {
    setup();
    const legend = screen.getByText('Scheduled').closest('ul');
    if (legend === null) throw new Error('legend not rendered');
    expect([...legend.querySelectorAll('[data-marker]')].map((marker) => marker.getAttribute('data-marker'))).toEqual([
      'failed',
      'published',
      'scheduled',
    ]);
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Failed', 'Published', 'Scheduled', 'Today']);
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  it('selects a day on click', () => {
    const props = setup();
    fireEvent.click(dayButton(/June 20, 2030/));
    expect(props.onSelect).toHaveBeenCalledWith('2030-06-20');
  });

  it('switches month with the navigation buttons', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 6);
    expect(props.onMonthNavigate).toHaveBeenLastCalledWith(2030, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 4);
    expect(props.onMonthNavigate).toHaveBeenLastCalledWith(2030, 4);
  });

  it('jumps to today and selects it', () => {
    const props = setup({ year: 2031, month: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 5);
    expect(props.onSelect).toHaveBeenLastCalledWith('2030-06-15');
  });

  it('places the Today button inside the month navigation, between the previous and next buttons', () => {
    setup();
    const nav = screen.getByRole('navigation');
    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName('Previous month');
    expect(buttons[1]).toHaveAccessibleName('Today');
    expect(buttons[2]).toHaveAccessibleName('Next month');
  });

  it('gives every day cell the same fixed height, so rows with markers do not grow', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-05', [{ status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    for (const day of [dayButton(/June 5, 2030/), dayButton(/June 15, 2030/)]) {
      expect(day.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-14', 'sm:h-20']));
      expect(day.className.split(/\s+/)).not.toContain('h-auto');
    }
  });

  it('shows only the weeks the month spans — no all-next-month row', () => {
    // February 2026 starts on a Sunday and has 28 days: exactly 4 weeks.
    setup({ year: 2026, month: 1, todayKey: '2026-02-10' });
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(4);
  });

  it('gives the month arrows a 40px target and no navy hover fill', () => {
    setup();
    for (const name of ['Previous month', 'Next month']) {
      const classes = screen.getByRole('button', { name }).className.split(/\s+/);
      expect(classes).toContain('size-10');
      expect(classes).toContain('hover:bg-sunken');
      expect(classes).not.toContain('hover:bg-accent');
    }
  });

  it('disables Today while today is shown and selected, and enables it otherwise', () => {
    setup({ selectedKey: '2030-06-15' });
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  it('keeps Today enabled when another day of the current month is selected', () => {
    setup({ selectedKey: '2030-06-20' });
    expect(screen.getByRole('button', { name: 'Today' })).toBeEnabled();
  });

  it('formats the weekday headers with Intl short names', () => {
    setup();
    const headers = screen.getAllByRole('columnheader', { hidden: true }).map((header) => header.textContent);
    expect(headers).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('moves keyboard focus with the arrow keys and selects with Enter', async () => {
    const props = setup({ selectedKey: '2030-06-20' });
    const user = userEvent.setup();
    // Focus lands on the selected day first; arrows move it, Enter selects.
    await user.click(dayButton(/June 20, 2030/));
    expect(props.onSelect).toHaveBeenLastCalledWith('2030-06-20');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(dayButton(/June 21, 2030/));
    await user.keyboard('{Enter}');
    expect(props.onSelect).toHaveBeenLastCalledWith('2030-06-21');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(dayButton(/June 28, 2030/));
  });

  it('arrowing past the month edge changes the shown month without moving the selection', async () => {
    // A static controlled month would pin the grid to June, so RDP snaps
    // focus back to the selected day: the harness must move the month like
    // the real page does, or the test measures the harness, not the app.
    const onSelect = vi.fn();
    const onMonthChange = vi.fn();
    const onMonthNavigate = vi.fn();
    function StatefulCalendar() {
      const [cursor, setCursor] = useState({ year: 2030, month: 5 });
      return (
        <CalendarView
          year={cursor.year}
          month={cursor.month}
          firstWeekday={0}
          slotsByDay={new Map()}
          scheduleById={SCHEDULES}
          personaPhotoById={PHOTOS}
          selectedKey="2030-06-20"
          todayKey="2030-06-15"
          onSelect={onSelect}
          onMonthChange={(year, month) => {
            onMonthChange(year, month);
            setCursor({ year, month });
          }}
          onMonthNavigate={onMonthNavigate}
        />
      );
    }
    render(<StatefulCalendar />);
    const user = userEvent.setup();
    await user.click(dayButton(/June 1, 2030/));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // June 1 is the first in-month day of the grid's first week: one step
    // left focuses May 31 and shows May, but selects nothing.
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(dayButton(/May 31, 2030/));
    expect(screen.getByText(/May 2030/)).toBeInTheDocument();
    expect(onMonthChange).toHaveBeenLastCalledWith(2030, 4);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMonthNavigate).not.toHaveBeenCalled();
  });
});
