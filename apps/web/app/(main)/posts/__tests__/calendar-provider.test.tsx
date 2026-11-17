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
  render(
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
  return handlers;
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
});
