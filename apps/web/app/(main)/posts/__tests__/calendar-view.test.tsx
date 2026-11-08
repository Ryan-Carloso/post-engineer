import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';
const EN: Record<string, string> = {
  'posts.calendarPrevMonth': 'Previous month',
  'posts.calendarNextMonth': 'Next month',
  'posts.calendarToday': 'Today',
  'posts.groupInProgress': 'In progress',
  'posts.groupPublished': 'Published',
  'posts.groupFailed': 'Failed',
  'posts.calendarDayLabel': '{date}: {summary}',
  'posts.calendarDayEmpty': '{date}: no posts',
  'posts.calendarMore': '+{count}',
};

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string, vars: Record<string, string | number> = {}) =>
      Object.entries(vars).reduce((out, [name, value]) => out.split(`{${name}}`).join(String(value)), EN[key] ?? key),
  }),
}));

import { CalendarView } from '../calendar-view';

function setup(overrides: Partial<React.ComponentProps<typeof CalendarView>> = {}) {
  const props = {
    year: 2030,
    month: 5,
    firstWeekday: 0 as const,
    slotsByDay: new Map<string, Pick<ScheduledSlot, 'status'>[]>(),
    selectedKey: null,
    todayKey: '2030-06-15',
    onSelect: vi.fn(),
    onMonthChange: vi.fn(),
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

  it('describes per-group counts in the accessible name and draws one icon marker per post', () => {
    const slotsByDay = new Map<string, Pick<ScheduledSlot, 'status'>[]>([
      ['2030-06-05', [{ status: 'awaiting' }, { status: 'published' }, { status: 'published' }, { status: 'failed' }, { status: 'failed' }]],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    expect(cell).toHaveAccessibleName('Wednesday, June 5, 2030: In progress: 1, Published: 2, Failed: 2');
    // 5 posts: 3 markers with distinct icons plus "+2".
    expect(cell.querySelectorAll('[data-group]')).toHaveLength(3);
    expect(cell.querySelectorAll('[data-group] svg')).toHaveLength(3);
    expect(cell).toHaveTextContent('+2');
  });

  it('names empty days explicitly and draws no markers', () => {
    setup();
    const cell = dayButton(/June 9, 2030/);
    expect(cell).toHaveAccessibleName('Sunday, June 9, 2030: no posts');
    expect(cell.querySelector('[data-group]')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 4);
  });

  it('jumps to today and selects it', () => {
    const props = setup({ year: 2031, month: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(props.onMonthChange).toHaveBeenLastCalledWith(2030, 5);
    expect(props.onSelect).toHaveBeenLastCalledWith('2030-06-15');
  });
});
