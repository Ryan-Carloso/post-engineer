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
  'posts.calendarGoToToday': 'Go to today',
  'posts.groupPublished': 'Published',
  'posts.groupFailed': 'Failed',
  'posts.groupScheduled': 'Scheduled',
  'posts.groupInProgress': 'In progress',
  'posts.filterActive': 'Filtered: only matching posts are shown',
  'posts.calendarDayLabel': '{date}: {summary}',
  'posts.calendarDayEmpty': '{date}: no posts',
  'posts.loadErrorCalendar': 'Could not load the calendar posts.',
  'posts.loadErrorRetry': 'Try again',
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
  ['s3', { personaId: 'p3' }],
]);
const PHOTOS = new Map<string, PersonaPhoto>([
  ['p1', { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' }],
  ['p2', { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' }],
  ['p3', { name: 'Ana Fit', photoUrl: 'https://example.test/ana.jpg' }],
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

  it('marks today with a top bar, gold wash on the numeral, and an in-cell dot, not a ring', () => {
    setup({ selectedKey: '2030-06-20' });
    const today = dayButton(/June 15, 2030/);
    const number = today.querySelector('[data-day-number]');
    expect(number).toHaveTextContent('15');
    expect(number?.className.split(/\s+/)).toContain('bg-warning/30');
    expect(today.querySelector('[data-today-bar="true"]')).not.toBeNull();
    const mark = today.querySelector('[data-today-mark="true"]');
    expect(mark?.className.split(/\s+/)).toContain('bg-warning');
    expect(mark?.className.split(/\s+/)).toContain('absolute');
    expect(mark?.className.split(/\s+/)).toContain('left-1');
    expect(number?.className.split(/\s+/)).not.toContain('ring-warning');
    expect(dayButton(/June 20, 2030/).querySelector('[data-today-mark]')).toBeNull();
  });

  it('keeps the today dot and post total as separate marks when today is selected', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-15', [{ status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-15T10:00:00.000Z' }]],
    ]);
    setup({ selectedKey: '2030-06-15', slotsByDay });
    const today = dayButton(/June 15, 2030/);
    expect(today.querySelector('[data-today-mark="true"]')).not.toBeNull();
    expect(today.querySelector('[data-day-post-total]')).toHaveTextContent('1');
    expect(today.className.split(/\s+/)).toContain('data-[selected-single=true]:outline-primary');
  });

  it('lays the legend out in one wrapping row inside the calendar card', () => {
    setup({
      slotsByDay: new Map([['2030-06-05', [{ status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T10:00:00.000Z' }]]]),
    });
    const legend = screen.getByText('posts.calendarLegendPostCount').closest('ul');
    if (legend === null) throw new Error('legend not rendered');
    expect(legend.className.split(/\s+/)).toContain('flex-wrap');
    expect(legend.className.split(/\s+/)).not.toContain('grid-cols-1');
    expect(legend.closest('[data-calendar-card]')).not.toBeNull();
  });

  it('dims the days outside the shown month', () => {
    setup();
    const grid = screen.getByRole('grid');
    const outside = within(grid)
      .getAllByRole('button')
      .find((button) => button.textContent === '1' && button.closest('[data-outside]') !== null);
    expect(outside?.querySelector('[data-day-number]')?.className.split(/\s+/)).toContain('opacity-50');
    expect(outside?.querySelector('[data-day-number]')?.className.split(/\s+/)).toContain('font-normal');
    const inside = dayButton(/June 20, 2030/);
    expect(inside.className.split(/\s+/)).toContain('[&>span]:opacity-100');
    expect(inside.querySelector('[data-day-number]')?.className.split(/\s+/)).toContain('font-semibold');
  });

  it('describes per-group counts in the accessible name, failure first, in the legend order', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T08:00:00.000Z' },
          { status: 'generating', scheduleId: 's1', slotAt: '2030-06-05T09:00:00.000Z' },
          { status: 'published', scheduleId: 's1', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T12:00:00.000Z' },
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T14:00:00.000Z' },
          { status: 'failed', scheduleId: 's2', slotAt: '2030-06-05T16:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    expect(cell).toHaveAccessibleName('Wednesday, June 5, 2030: Failed: 2, Published: 2, In progress: 1, Scheduled: 1');
  });

  it('shows one post total in the cell when several statuses share a day', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay, selectedKey: '2030-06-05' });
    const cell = dayButton(/June 5, 2030/);
    expect(cell.querySelector('[data-day-post-total]')).toHaveTextContent('2');
    expect(cell.querySelectorAll('[data-marker]')).toHaveLength(0);
  });

  it('shows one total even when more than two groups share a day', () => {
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
    expect(dayButton(/June 5, 2030/).querySelector('[data-day-post-total]')).toHaveTextContent('4');
    expect(dayButton(/June 6, 2030/).querySelector('[data-day-post-total]')).toHaveTextContent('1');
    expect(dayButton(/June 5, 2030/).className.split(/\s+/)).not.toContain('bg-destructive-soft');
  });

  // Selection is a navy outline on a clear cell. A failure stays on the
  // chip, so a selected failed day is not a red block and an empty day is
  // not a filled block.
  it('outlines a selected failed day and leaves the failure on the chip', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-05', [{ status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' }]],
    ]);
    setup({ slotsByDay, selectedKey: '2030-06-05' });
    const classes = dayButton(/June 5, 2030/).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'data-[selected-single=true]:bg-transparent',
        'data-[selected-single=true]:outline-primary',
        'data-[selected-single=true]:text-primary',
      ]),
    );
    expect(classes).not.toContain('bg-destructive-soft');
    expect(classes).not.toContain('data-[selected-single=true]:bg-primary');
    expect(dayButton(/June 5, 2030/).querySelector('[data-day-post-total]')).toHaveTextContent('1');
  });

  it('draws a selected day as the same outline, not a navy or blue block', () => {
    setup({ selectedKey: '2030-06-20' });
    const classes = dayButton(/June 20, 2030/).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['data-[selected-single=true]:bg-transparent', 'data-[selected-single=true]:outline-primary']),
    );
    expect(classes).not.toContain('data-[selected-single=true]:bg-info-soft');
    expect(classes).not.toContain('data-[selected-single=true]:bg-primary');
    expect(classes).not.toContain('data-[selected-single=true]:text-primary-foreground');
  });

  it('shows one total for four posts across every status group', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      [
        '2030-06-05',
        [
          { status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T08:00:00.000Z' },
          { status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' },
          { status: 'generating', scheduleId: 's1', slotAt: '2030-06-05T11:00:00.000Z' },
          { status: 'awaiting', scheduleId: 's3', slotAt: '2030-06-05T12:00:00.000Z' },
        ],
      ],
    ]);
    setup({ slotsByDay });
  const cell = dayButton(/June 5, 2030/);
    expect(cell.querySelector('[data-day-post-total]')).toHaveTextContent('4');
    expect(cell.querySelector('[data-personas]')).toBeNull();
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
    expect(cell.querySelector('[data-day-post-total]')).toHaveTextContent('2');
  });

  it('names empty days explicitly and draws no marker or persona', () => {
    setup();
    const cell = dayButton(/June 9, 2030/);
    expect(cell).toHaveAccessibleName('Sunday, June 9, 2030: no posts');
    expect(cell.querySelector('[data-marker]')).toBeNull();
    expect(cell.querySelector('[data-personas]')).toBeNull();
  });

  it('legends the grid vocabulary — post count, today, and selected day', () => {
    setup({
      slotsByDay: new Map([['2030-06-05', [{ status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T10:00:00.000Z' }]]]),
    });
    const legend = screen.getByText('posts.calendarLegendPostCount').closest('ul');
    if (legend === null) throw new Error('legend not rendered');
    expect(legend.querySelectorAll('[data-marker]')).toHaveLength(0);
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'posts.calendarLegendPostCount',
      'Today',
      'posts.calendarLegendSelected',
    ]);
    const countSwatch = legend.querySelector('[data-legend-post-total]');
    expect(countSwatch).toBeTruthy();
    expect(countSwatch).toBeEmptyDOMElement();
    expect(countSwatch?.className.split(/\s+/)).toContain('border-primary/40');
    const selectedSwatch = legend.querySelector('[data-legend-selected-day]');
    expect(selectedSwatch).toBeEmptyDOMElement();
    const todaySwatch = legend.querySelector('[data-legend-today-mark]');
    expect(todaySwatch?.querySelector('[data-legend-today-bar]')).not.toBeNull();
    expect(todaySwatch?.querySelector('[data-legend-today-wash]')).not.toBeNull();
    expect(todaySwatch?.querySelector('[data-legend-today-dot]')).not.toBeNull();
    expect(selectedSwatch?.className.split(/\s+/)).toContain('outline-primary');
    expect(legend.querySelector('[data-filter-hint]')).toBeNull();
  });

  it('says in the legend when a filter hides some posts', () => {
    setup({
      filtered: true,
      slotsByDay: new Map([['2030-06-05', [{ status: 'awaiting', scheduleId: 's1', slotAt: '2030-06-05T10:00:00.000Z' }]]]),
    });
    expect(screen.getAllByText('Filtered: only matching posts are shown')[0].closest('[data-filter-hint]')).not.toBeNull();
  });

  // A failed load must not read as an empty month: disabled days, readable
  // numbers, no selection, no markers, no legend — but the month can still
  // change. There is no "not loaded" pill over the cells.
  it('covers an unavailable grid and hides today gold so a failed load does not read empty', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-05', [{ status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' }]],
    ]);
    const onLoadErrorRetry = vi.fn();
    const props = setup({
      slotsByDay,
      selectedKey: '2030-06-15',
      unavailable: true,
      loadErrorMessageKey: 'posts.loadErrorCalendar',
      onLoadErrorRetry,
    });
    expect(screen.queryByText('Posts not loaded')).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-grid-outline]')).toBeNull();
    expect(screen.queryByText('posts.calendarLegendPostCount')).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-load-error]')?.closest('[data-calendar-card]')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onLoadErrorRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('keeps seven table cells per week on a narrow layout', () => {
    setup();
    const headerRow = screen.getByRole('grid').querySelector('thead tr');
    expect(headerRow?.children).toHaveLength(7);
    const firstWeek = within(screen.getByRole('grid')).getAllByRole('row')[0];
    expect(firstWeek.children).toHaveLength(7);
  });

  it('hides the legend when the visible month has no posts', () => {
    setup({ slotsByDay: new Map() });
    expect(screen.queryByText('posts.calendarLegendPostCount')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 5);
    expect(props.onSelect).toHaveBeenLastCalledWith('2030-06-15');
  });

  it('places the go-to-today button inside the month navigation, between the previous and next buttons', () => {
    setup();
    const nav = screen.getByRole('navigation');
    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName('Previous month');
    expect(buttons[1]).toHaveAccessibleName('Go to today');
    expect(buttons[2]).toHaveAccessibleName('Next month');
  });

  it('gives every day cell the same fixed height, so rows with markers do not grow', () => {
    const slotsByDay = new Map<string, DaySlot[]>([
      ['2030-06-05', [{ status: 'failed', scheduleId: 's1', slotAt: '2030-06-05T12:00:00.000Z' }]],
    ]);
    setup({ slotsByDay });
    for (const day of [dayButton(/June 5, 2030/), dayButton(/June 15, 2030/)]) {
      expect(day.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-[4.5rem]', 'max-xl:h-[4.75rem]', 'sm:h-24']));
      expect(day.className.split(/\s+/)).not.toContain('h-auto');
      // The month table, not the chip text, owns the column width.
      const cell = day.parentElement;
      expect(cell?.className.split(/\s+/)).toEqual(expect.arrayContaining(['table-cell', 'min-w-0']));
      expect(day.closest('table')?.className.split(/\s+/)).toContain('table-fixed');
    }
  });

  it('shortens week rows that have no posts on narrow screens', () => {
    setup({
      slotsByDay: new Map([
        ['2030-06-05', [{ status: 'published', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z' }]],
      ]),
    });
    const grid = screen.getByRole('grid');
    const emptyWeek = grid.querySelector('tr[data-week-has-posts="false"]');
    expect(emptyWeek).not.toBeNull();
    expect(emptyWeek?.className.split(/\s+/)).toContain('max-xl:[&_[data-day-button]]:h-11');
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
      expect(classes).toContain('text-ink');
      expect(classes).toContain('hover:bg-sunken');
      expect(classes).not.toContain('hover:bg-accent');
      expect(classes).not.toContain('active:bg-line');
    }
  });

  // Pressed when today is the selected day: a solid fill of the same size,
  // never a disabled-looking label, so the arrows around it never shift.
  it('marks go-to-today pressed when today is selected, and keeps it enabled', () => {
    setup({ selectedKey: '2030-06-15' });
    const onToday = screen.getByRole('button', { name: 'Go to today' });
    expect(onToday).toBeEnabled();
    expect(onToday).toHaveAttribute('aria-pressed', 'true');
    const onTodayClasses = onToday.className.split(/\s+/);
    expect(onTodayClasses).toEqual(expect.arrayContaining(['h-10', 'px-3', 'bg-primary', 'text-on-ink']));
    expect(onTodayClasses).not.toContain('opacity-50');
  });

  it('leaves go-to-today unpressed, at the same size, when another day is selected', () => {
    setup({ selectedKey: '2030-06-20' });
    const today = screen.getByRole('button', { name: 'Go to today' });
    expect(today).toBeEnabled();
    expect(today).toHaveAttribute('aria-pressed', 'false');
    expect(today.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-10', 'px-3', 'border', 'border-input', 'bg-card']));
    expect(today.className.split(/\s+/)).not.toContain('bg-primary');
  });

  it('formats the weekday headers with Intl short names', () => {
    setup();
    const headers = screen.getAllByRole('columnheader', { hidden: true }).map((header) => header.textContent);
    expect(headers).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('capitalizes the weekday headers (pt-BR Intl names are lowercase)', () => {
    setup();
    for (const header of screen.getAllByRole('columnheader', { hidden: true })) {
      expect(header.className.split(/\s+/)).toContain('capitalize');
      expect(header.className.split(/\s+/)).toContain('text-center');
    }
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
