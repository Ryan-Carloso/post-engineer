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
    // Fixed 6-week grid, so the range read always covers what is shown.
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

  it('draws today as a thick border, not a filled background, and keeps it readable when another day is selected', () => {
    setup({ selectedKey: '2030-06-20' });
    const today = dayButton(/June 15, 2030/);
    // Thick primary border on the day button; no accent fill that could read
    // as "selected" (a bare bg-accent token — hover: and data- variants in
    // the shared button styles do not fill the cell).
    expect(today.className).toContain('border-2');
    expect(today.className).toContain('border-primary');
    expect(today.className.split(/\s+/)).not.toContain('bg-accent');
    expect(today.closest('[data-today]')?.className.split(/\s+/)).not.toContain('bg-accent');
    // The selected day (not today) carries no today border.
    expect(dayButton(/June 20, 2030/).className).not.toContain('border-primary');
    expect(dayButton(/June 20, 2030/).className).not.toContain('border-card');
    expect(dayButton(/June 20, 2030/).className.split(/\s+/)).not.toContain('border-ring');
  });

  it('keeps today readable when today itself is selected: the border switches to the ring color against the selected fill', () => {
    setup({ selectedKey: '2030-06-15' });
    const today = dayButton(/June 15, 2030/);
    expect(today.className).toContain('border-2');
    // A card-colored border sits on the card behind the button, so the
    // frame vanishes against it; a primary border would vanish against
    // the selected fill. The ring token contrasts with both the selected
    // fill and the card, in both themes.
    expect(today.className.split(/\s+/)).toContain('border-ring');
    expect(today.className.split(/\s+/)).not.toContain('border-primary');
    expect(today.className.split(/\s+/)).not.toContain('border-card');
  });

  it('describes per-group counts in the accessible name: published, failed, scheduled — never in progress', () => {
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
    expect(cell).toHaveAccessibleName('Wednesday, June 5, 2030: Published: 2, Failed: 2, Scheduled: 1');
  });

  it('shows the failed post persona photo with a failed ring on a mixed day', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    // The photo is aria-hidden (the day label carries the counts), so the
    // image is asserted by DOM, not by role.
    expect(cell.querySelector('img[alt="Viva Leve"]')).not.toBeNull();
    const ring = cell.querySelector('[data-ring]');
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute('data-ring', 'failed');
    expect(ring).toHaveAttribute('data-mixed', 'true');
  });

  it('shows the published ring on a published-only day and no ring on a scheduled-only day', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-06', [{ status: 'published', scheduleId: 's2', slotAt: '2030-06-06T10:00:00.000Z' }]],
      ['2030-06-07', [{ status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-07T10:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    const published = dayButton(/June 6, 2030/);
    expect(published.querySelector('img[alt="Bicuda"]')).not.toBeNull();
    expect(published.querySelector('[data-ring]')).toHaveAttribute('data-ring', 'published');
    expect(published.querySelector('[data-ring]')).toHaveAttribute('data-mixed', 'false');
    const scheduled = dayButton(/June 7, 2030/);
    expect(scheduled.querySelector('img[alt="Viva Leve"]')).not.toBeNull();
    expect(scheduled.querySelector('[data-ring]')).toHaveAttribute('data-ring', 'scheduled');
  });

  it('shows a neutral count placeholder when no post on the day resolves to a persona', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-09', [{ status: 'awaiting', scheduleId: 's-gone', slotAt: '2030-06-09T10:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 9, 2030/);
    expect(cell.querySelector('[data-photo="none"]')).toHaveTextContent('1');
    expect(cell.querySelector('[data-ring]')).toBeNull();
  });

  it('shows how many posts a day holds on the photo: a multi-post day never looks like a single post', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T14:00:00.000Z' },
        ],
      ],
      ['2030-06-06', [{ status: 'published', scheduleId: 's2', slotAt: '2030-06-06T10:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    const busy = dayButton(/June 5, 2030/);
    expect(busy.querySelector('[data-count="3"]')).toHaveTextContent('3');
    // One post, one photo, no badge.
    expect(dayButton(/June 6, 2030/).querySelector('[data-count]')).toBeNull();
  });

  it('counts a multi-post day with no resolvable persona on the neutral placeholder', () => {
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
    expect(cell.querySelector('[data-photo="none"]')).toHaveAttribute('data-count', '2');
    expect(cell.querySelector('[data-photo="none"]')).toHaveTextContent('2');
  });

  it('names empty days explicitly and draws no photo or placeholder', () => {
    setup();
    const cell = dayButton(/June 9, 2030/);
    expect(cell).toHaveAccessibleName('Sunday, June 9, 2030: no posts');
    expect(cell.querySelector('[data-ring]')).toBeNull();
    expect(cell.querySelector('[data-photo]')).toBeNull();
  });

  it('legends only published, failed and scheduled — no in-progress blue', () => {
    setup();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
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

  it('keeps day cells compact so markers do not sit lost in tall empty cells', () => {
    setup();
    const day = dayButton(/June 15, 2030/);
    expect(day.className).toContain('min-h-11');
    expect(day.className).toContain('sm:min-h-14');
    expect(day.className).not.toContain('min-h-12');
    expect(day.className).not.toContain('sm:min-h-16');
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
