import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';
import { CalendarView, type CalendarLabels } from '../calendar-view';

const labels: CalendarLabels = {
  grid: 'Posts calendar',
  prev: 'Previous month',
  next: 'Next month',
  today: 'Today',
  groups: { inProgress: 'In progress', published: 'Published', failed: 'Failed' },
  dayLabel: (date, summary) => `${date}: ${summary}`,
  dayEmpty: (date) => `${date}: no posts`,
  more: (count) => `+${count}`,
};

function setup(overrides: Partial<React.ComponentProps<typeof CalendarView>> = {}) {
  const props = {
    year: 2030,
    month: 5,
    locale: 'en' as const,
    firstWeekday: 0 as const,
    slotsByDay: new Map<string, Pick<ScheduledSlot, 'status'>[]>(),
    selectedKey: null,
    focusKey: '2030-06-12',
    todayKey: '2030-06-15',
    labels,
    onSelect: vi.fn(),
    onFocusChange: vi.fn(),
    onMonthChange: vi.fn(),
    ...overrides,
  };
  render(<CalendarView {...(props as React.ComponentProps<typeof CalendarView>)} />);
  return props;
}

const dayButton = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name });

describe('CalendarView', () => {
  it('exposes grid semantics with localized weekday headers and month title', () => {
    setup();
    expect(screen.getByRole('grid', { name: 'Posts calendar' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getAllByRole('columnheader')[0]).toHaveAccessibleName('Sunday');
    expect(screen.getByRole('heading', { name: /June 2030/ })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(7); // header + 6 weeks
  });

  it('keeps a single roving tab stop on the focus day', () => {
    setup();
    const stops = within(screen.getByRole('grid')).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName(/Wednesday, June 12, 2030/);
  });

  it('falls back to the 1st of the month when the focus day left the grid', () => {
    setup({ focusKey: '2031-01-01' });
    const stops = within(screen.getByRole('grid')).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName(/June 1, 2030/);
  });

  it('marks today and the selected day', () => {
    setup({ selectedKey: '2030-06-20' });
    expect(dayButton(/June 15, 2030/)).toHaveAttribute('aria-current', 'date');
    expect(dayButton(/June 20, 2030/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('describes per-group counts in the accessible name and draws one icon marker per post', () => {
    const slotsByDay = new Map<string, Pick<ScheduledSlot, 'status'>[]>([
      ['2030-06-05', [{ status: 'awaiting' }, { status: 'published' }, { status: 'published' }, { status: 'failed' }, { status: 'failed' }]],
    ]);
    setup({ slotsByDay });
    const cell = dayButton(/June 5, 2030/);
    expect(cell).toHaveAccessibleName(/In progress: 1, Published: 2, Failed: 2/);
    // 5 posts: 3 markers with distinct icons plus "+2".
    expect(cell.querySelectorAll('[data-group]')).toHaveLength(3);
    expect(cell.querySelectorAll('[data-group] svg')).toHaveLength(3);
    expect(cell).toHaveTextContent('+2');
  });

  it('names empty days explicitly', () => {
    setup();
    expect(dayButton(/June 9, 2030/)).toHaveAccessibleName(/no posts/);
  });

  it('selects a day on click', () => {
    const props = setup();
    fireEvent.click(dayButton(/June 20, 2030/));
    expect(props.onSelect).toHaveBeenCalledWith('2030-06-20');
    expect(props.onFocusChange).toHaveBeenCalledWith('2030-06-20');
  });

  it('moves focus with the arrow keys and Home/End', () => {
    const props = setup();
    fireEvent.keyDown(dayButton(/June 12, 2030/), { key: 'ArrowRight' });
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-06-13');
    fireEvent.keyDown(dayButton(/June 12, 2030/), { key: 'ArrowDown' });
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-06-19');
    fireEvent.keyDown(dayButton(/June 12, 2030/), { key: 'Home' });
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-06-09');
    fireEvent.keyDown(dayButton(/June 12, 2030/), { key: 'End' });
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-06-15');
    expect(props.onMonthChange).not.toHaveBeenCalled();
  });

  it('changes month when the keyboard leaves the visible grid', () => {
    const props = setup({ focusKey: '2030-06-12' });
    fireEvent.keyDown(dayButton(/June 12, 2030/), { key: 'PageDown' });
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-07-12');
    expect(props.onMonthChange).toHaveBeenCalledWith(2030, 6); // July 12 is past the 6-week June grid
  });

  it('keeps the month when the keyboard stays inside the visible grid', () => {
    const props = setup({ focusKey: '2030-06-30' });
    fireEvent.keyDown(dayButton(/June 30, 2030/), { key: 'ArrowRight' }); // July 1 is still in the June grid
    expect(props.onFocusChange).toHaveBeenLastCalledWith('2030-07-01');
    expect(props.onMonthChange).not.toHaveBeenCalled();
  });

  it('switches month with the header buttons', () => {
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

  it('disables month navigation while loading', () => {
    setup({ disabled: true });
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
  });
});
