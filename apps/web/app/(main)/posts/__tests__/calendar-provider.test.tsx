import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// Tests for the posts month calendar (CalendarCN month view, read-only):
// chips navigate, days select, drag/resize/context menu stay off.
// "Today" is pinned to 2030-06-01, a Saturday, so the grid opens on June 2030.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { PostsCalendar } from '../calendar-provider';
import type { DetailedCalendarEvent } from '@/components/calendar-types';

function calendarEvent(overrides: Partial<DetailedCalendarEvent> = {}): DetailedCalendarEvent {
  return {
    id: 'e1',
    title: 'Morning post',
    start: new Date('2030-06-01T10:00:00.000Z'),
    end: new Date('2030-06-01T10:00:00.000Z'),
    color: 'blue',
    calendarId: 's1',
    ...overrides,
  };
}

function renderCalendar(props: Record<string, unknown> = {}) {
  const handlers = {
    onSelectDay: vi.fn(),
    onDateChange: vi.fn(),
    onMonthNavigate: vi.fn(),
    onGoToToday: vi.fn(),
  };
  const result = render(
    <PostsCalendar
      events={[]}
      date={new Date(2030, 5, 1)}
      weekStartsOn={0}
      locale="en"
      loading={false}
      todayPressed={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, unmount: result.unmount };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-06-01T12:00:00.000Z'));
  pushMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PostsCalendar', () => {
  it('shows the month label and the prev, next and today controls', () => {
    renderCalendar();
    expect(screen.getByText('June 2030')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarPrevMonth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarNextMonth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarGoToToday' })).toBeInTheDocument();
  });

  it('names the month the old grid did: no "de" in the Portuguese caption', () => {
    renderCalendar({ locale: 'pt', date: new Date(2026, 10, 1) });
    expect(screen.getByText('Novembro 2026')).toBeInTheDocument();
  });

  it('moves to the next month from the toolbar', () => {
    const { onMonthNavigate } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(onMonthNavigate).toHaveBeenCalledWith(2030, 6);
  });

  it('shows an event chip with its time and title on its day', () => {
    renderCalendar({ events: [calendarEvent()] });
    expect(screen.getByText('Morning post')).toBeInTheDocument();
    expect(screen.getByText('10 AM')).toBeInTheDocument();
  });

  it('paints the chip with the event color', () => {
    renderCalendar({ events: [calendarEvent({ color: 'red' })] });
    const chip = screen.getByText('Morning post').closest('[data-event-id]');
    expect(chip?.querySelector('.bg-event-red-border')).not.toBeNull();
  });

  it('navigates to the post detail when its chip is clicked', () => {
    renderCalendar({ events: [calendarEvent()] });
    fireEvent.click(screen.getByText('Morning post'));
    expect(pushMock).toHaveBeenCalledWith('/posts/e1');
  });

  it('selects the day when its day number is clicked', () => {
    const { onSelectDay } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Sunday, June 2' }));
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-02');
  });

  it('selects the day when its overflow button is clicked', () => {
    const { onSelectDay } = renderCalendar({
      events: Array.from({ length: 6 }, (_, i) =>
        calendarEvent({
          id: `overflow-${i}`,
          title: `Overflow ${i}`,
          start: new Date('2030-06-03T10:00:00.000Z'),
          end: new Date('2030-06-03T10:00:00.000Z'),
        }),
      ),
    });
    // In jsdom the cells measure 0px tall, so fewer slots fit than in a real
    // browser: only the day matters here, not the exact overflow count.
    fireEvent.click(screen.getByRole('button', { name: /Show \d+ more events/ }));
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-03');
  });

  it('does not create an event when an empty day is clicked', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Sunday, June 2' }));
    expect(screen.queryByText('New event')).toBeNull();
  });

  it('does not start a drag on an event chip: press, move and release navigates nowhere', () => {
    renderCalendar({ events: [calendarEvent()] });
    const chip = screen.getByText('Morning post');
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 200, clientY: 200 }));
    // No floating drag copy follows the pointer.
    expect(document.querySelector('.pointer-events-none.fixed')).toBeNull();
    // The trailing click is a drag, not a click: it must not navigate either.
    fireEvent.click(chip, { clientX: 200, clientY: 200 });
    expect(pushMock).not.toHaveBeenCalled();
    // The chip never left its day.
    expect(screen.getByText('Morning post')).toBeInTheDocument();
  });

  it('does not open the context menu on a right-clicked event', () => {
    renderCalendar({ events: [calendarEvent()] });
    fireEvent.contextMenu(screen.getByText('Morning post'));
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByText('Duplicate')).toBeNull();
  });

  it('ignores day clicks when muted', () => {
    const { onSelectDay } = renderCalendar({ muted: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sunday, June 2' }));
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('does not swallow wheel scroll over the grid: the page keeps the event and the month stays', async () => {
    const { onDateChange } = renderCalendar({ events: [calendarEvent()] });
    // The lib's wheel nav is a week step from the 1st, so wheel-down lands
    // in the same month and the page would drop it — while the lib's
    // preventDefault kills the page scroll. The wrapper must stop the
    // wheel before it reaches the lib, so the page scrolls instead.
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    screen.getByRole('button', { name: 'Sunday, June 2' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    // Past the lib's 150ms scroll-end debounce: no month change either.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it('prevents the browser default on Alt+Arrow over a focused event chip', () => {
    const { onDateChange } = renderCalendar({ events: [calendarEvent()] });
    // The capture handler stops the event before the lib's keyboard
    // handler runs, so the lib's preventDefault never fires — without one
    // here, Alt+Left/Right navigates the browser history on Windows/Linux.
    const prevented = fireEvent.keyDown(screen.getByText('Morning post'), { altKey: true, key: 'ArrowLeft' });
    expect(prevented).toBe(false);
    expect(onDateChange).not.toHaveBeenCalled();
  });

  // The Alt+Arrow guard is one condition over four keys: every key must
  // prevent, and a non-arrow key or a missing Alt must not.
  it.each([['ArrowUp'], ['ArrowDown'], ['ArrowRight']])(
    'prevents the browser default on Alt+%s over a focused event chip',
    (key) => {
      renderCalendar({ events: [calendarEvent()] });
      const prevented = fireEvent.keyDown(screen.getByText('Morning post'), { altKey: true, key });
      expect(prevented).toBe(false);
    },
  );

  it('does not prevent the browser default on Alt+letter over a focused event chip', () => {
    renderCalendar({ events: [calendarEvent()] });
    // A letter is not an arrow: neither the capture guard nor the lib's
    // keyboard handler prevents it. (Alt+Enter is prevented by the lib's
    // popover handling, so it cannot pin this guard.)
    const prevented = fireEvent.keyDown(screen.getByText('Morning post'), { altKey: true, key: 'a' });
    expect(prevented).toBe(true);
  });

  it('does not prevent the browser default on ArrowLeft without Alt over a focused event chip', () => {
    renderCalendar({ events: [calendarEvent()] });
    const prevented = fireEvent.keyDown(screen.getByText('Morning post'), { key: 'ArrowLeft' });
    expect(prevented).toBe(true);
  });

  it('does not prevent the browser default on Alt+Arrow over a day with no event', () => {
    renderCalendar({ events: [calendarEvent()] });
    const prevented = fireEvent.keyDown(screen.getByRole('button', { name: 'Sunday, June 2' }), {
      altKey: true,
      key: 'ArrowLeft',
    });
    expect(prevented).toBe(true);
  });

  // The wheel guard is a native capture listener on the month wrapper: a
  // wheel over a day must never reach the grid cells below it, so the
  // page scrolls instead of the lib stepping a week.
  it('stops wheel scroll at the month wrapper before it reaches the grid cells', () => {
    renderCalendar({ events: [calendarEvent()] });
    const cell = document.querySelector('[data-date="2030-06-02"]') as HTMLElement;
    const cellWheel = vi.fn();
    cell.addEventListener('wheel', cellWheel);
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    screen.getByRole('button', { name: 'Sunday, June 2' }).dispatchEvent(event);
    expect(cellWheel).not.toHaveBeenCalled();
    cell.removeEventListener('wheel', cellWheel);
  });

  it('removes the wheel listener when the calendar unmounts', () => {
    const { unmount } = renderCalendar();
    const el = document.querySelector('[data-posts-calendar-month]') as HTMLElement;
    const removeSpy = vi.spyOn(el, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { capture: true });
    removeSpy.mockRestore();
  });

  // The drag guard reads the press and the trailing click: only a press
  // that wandered past the threshold counts as a drag.
  it('treats a press that moved only horizontally as a drag', () => {
    renderCalendar({ events: [calendarEvent()] });
    const chip = screen.getByText('Morning post');
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(chip, { clientX: 200, clientY: 100 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('treats a press that moved only vertically as a drag', () => {
    renderCalendar({ events: [calendarEvent()] });
    const chip = screen.getByText('Morning post');
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(chip, { clientX: 100, clientY: 200 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('treats a press that moved exactly the threshold as a click', () => {
    renderCalendar({ events: [calendarEvent()] });
    const chip = screen.getByText('Morning post');
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(chip, { clientX: 104, clientY: 100 });
    expect(pushMock).toHaveBeenCalledWith('/posts/e1');
  });

  it('treats a press that moved the threshold backwards as a click', () => {
    renderCalendar({ events: [calendarEvent()] });
    const chip = screen.getByText('Morning post');
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(chip, { clientX: 96, clientY: 100 });
    expect(pushMock).toHaveBeenCalledWith('/posts/e1');
  });

  it('navigates when a dragged press lands on a different event', () => {
    renderCalendar({
      events: [
        calendarEvent(),
        calendarEvent({ id: 'e2', title: 'Evening post', start: new Date('2030-06-01T18:00:00.000Z'), end: new Date('2030-06-01T18:00:00.000Z') }),
      ],
    });
    fireEvent.pointerDown(screen.getByText('Morning post'), { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(screen.getByText('Evening post'), { clientX: 200, clientY: 200 });
    expect(pushMock).toHaveBeenCalledWith('/posts/e2');
  });

  it('selects the day when a dragged press lands on a day with no event', () => {
    const { onSelectDay } = renderCalendar({ events: [calendarEvent()] });
    fireEvent.pointerDown(screen.getByText('Morning post'), { pointerId: 1, clientX: 100, clientY: 100, button: 0, isPrimary: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sunday, June 2' }), { clientX: 200, clientY: 200 });
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-02');
  });

  // The context-menu guard stops the menu only on an event: a day's menu
  // must still reach the page.
  it('lets a context menu opened on a day with no event reach the page', () => {
    const onContextMenu = vi.fn();
    render(
      <div onContextMenu={onContextMenu}>
        <PostsCalendar
          events={[calendarEvent()]}
          date={new Date(2030, 5, 1)}
          weekStartsOn={0}
          locale="en"
          loading={false}
          todayPressed={false}
          onSelectDay={vi.fn()}
          onDateChange={vi.fn()}
          onMonthNavigate={vi.fn()}
          onGoToToday={vi.fn()}
        />
      </div>,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Sunday, June 2' }));
    expect(onContextMenu).toHaveBeenCalled();
  });

  it('stops a context menu opened on an event from reaching the page', () => {
    const onContextMenu = vi.fn();
    render(
      <div onContextMenu={onContextMenu}>
        <PostsCalendar
          events={[calendarEvent()]}
          date={new Date(2030, 5, 1)}
          weekStartsOn={0}
          locale="en"
          loading={false}
          todayPressed={false}
          onSelectDay={vi.fn()}
          onDateChange={vi.fn()}
          onMonthNavigate={vi.fn()}
          onGoToToday={vi.fn()}
        />
      </div>,
    );
    fireEvent.contextMenu(screen.getByText('Morning post'));
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  // The read-only chrome: muted grids are inert, chevrons are 40px
  // targets, the Today control reads its pressed state, and the clock
  // follows the locale.
  it('marks the grid non-interactive when muted', () => {
    renderCalendar({ muted: true });
    expect(document.querySelector('[data-calendar-card]')?.className.split(/\s+/)).toContain('pointer-events-none');
  });

  it('keeps the grid interactive when not muted', () => {
    renderCalendar();
    expect(document.querySelector('[data-calendar-card]')?.className.split(/\s+/)).not.toContain('pointer-events-none');
  });

  it('sizes the month chevrons as 40px touch targets', () => {
    renderCalendar();
    const prev = screen.getByRole('button', { name: 'posts.calendarPrevMonth' });
    expect(prev.className.split(/\s+/)).toContain('size-10');
  });

  it('marks the Today control pressed with the brand fill when today is selected', () => {
    renderCalendar({ todayPressed: true });
    const today = screen.getByRole('button', { name: 'posts.calendarGoToToday' });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.className.split(/\s+/)).toContain('h-10');
    expect(today.className.split(/\s+/)).toContain('bg-brand');
  });

  it('marks the Today control unpressed with the outline style when another day is selected', () => {
    renderCalendar({ todayPressed: false });
    const today = screen.getByRole('button', { name: 'posts.calendarGoToToday' });
    expect(today.getAttribute('aria-pressed')).toBe('false');
    expect(today.className.split(/\s+/)).toContain('border');
  });

  it('shows 24-hour times in Portuguese', () => {
    renderCalendar({
      locale: 'pt',
      events: [calendarEvent({ start: new Date('2030-06-01T20:00:00.000Z'), end: new Date('2030-06-01T20:00:00.000Z') })],
    });
    expect(screen.getByText('20:00')).toBeInTheDocument();
  });

  it('shows 12-hour times in English', () => {
    renderCalendar({
      events: [calendarEvent({ start: new Date('2030-06-01T20:00:00.000Z'), end: new Date('2030-06-01T20:00:00.000Z') })],
    });
    expect(screen.getByText('8 PM')).toBeInTheDocument();
  });

  it('shows no event popover when an event chip is clicked', () => {
    renderCalendar({ events: [calendarEvent()] });
    fireEvent.click(screen.getByText('Morning post'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('selects the day when its cell, not just its number, is clicked', () => {
    const { onSelectDay } = renderCalendar();
    const cell = document.querySelector('[data-date="2030-06-02"]') as HTMLElement;
    fireEvent.click(cell);
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-02');
  });

  it('selects nothing when the calendar card background is clicked', () => {
    const { onSelectDay } = renderCalendar();
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    fireEvent.click(card);
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('ignores cell clicks when muted', () => {
    const { onSelectDay } = renderCalendar({ muted: true });
    const cell = document.querySelector('[data-date="2030-06-02"]') as HTMLElement;
    fireEvent.click(cell);
    expect(onSelectDay).not.toHaveBeenCalled();
  });
});
