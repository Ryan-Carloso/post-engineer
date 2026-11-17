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

import { PostsCalendar, dayColumnIndexForPoint, formatWeekRange } from '../calendar-provider';
import type { DetailedCalendarEvent } from '@/components/calendar-types';
import { useI18n } from '@/lib/i18n/provider';
import { postsCalendarStrings } from '@/lib/i18n/posts-calendar-i18n';

// Resolves a posts key against the real dictionary (the module mock's `t`
// returns the key verbatim, so the range text would never appear).
function realT(locale: 'en' | 'pt') {
  return (key: string, vars?: Record<string, string | number>) => {
    const parts = key.split('.');
    let current: unknown = postsCalendarStrings[locale];
    for (const part of parts) current = (current as Record<string, unknown>)[part];
    let text = String(current);
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}

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
      // The lib defaults an undefined view to "week", so the month suite
      // passes it explicitly — the month grid is what this suite tests.
      view="month"
      showViewSwitcher={false}
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

describe('formatWeekRange', () => {
  it('shows one month when the week stays inside it', () => {
    expect(formatWeekRange(new Date(2030, 5, 2), new Date(2030, 5, 8), 'en')).toBe('2 – 8 Jun');
    expect(formatWeekRange(new Date(2030, 5, 2), new Date(2030, 5, 8), 'pt')).toBe('2 – 8 Jun');
  });

  it('names both months when the week straddles them', () => {
    expect(formatWeekRange(new Date(2030, 10, 30), new Date(2030, 11, 6), 'en')).toBe('30 Nov – 6 Dec');
    expect(formatWeekRange(new Date(2030, 10, 30), new Date(2030, 11, 6), 'pt')).toBe('30 Nov – 6 Dez');
  });
});

describe('dayColumnIndexForPoint', () => {
  const columns = [
    { left: 100, right: 150 },
    { left: 150, right: 200 },
    { left: 200, right: 250 },
  ];

  it('finds the column under the point, left edge inclusive', () => {
    expect(dayColumnIndexForPoint(149, columns)).toBe(0);
    expect(dayColumnIndexForPoint(150, columns)).toBe(1);
    expect(dayColumnIndexForPoint(249, columns)).toBe(2);
  });

  it('returns -1 outside every column', () => {
    expect(dayColumnIndexForPoint(99, columns)).toBe(-1);
    expect(dayColumnIndexForPoint(250, columns)).toBe(-1);
  });
});

describe('PostsCalendar week view', () => {
  // The week of Sunday 2030-06-02 (weekStartsOn 0): 2–8 June 2030.
  function renderWeek(props: Record<string, unknown> = {}) {
    const handlers = {
      onSelectDay: vi.fn(),
      onDateChange: vi.fn(),
      onMonthNavigate: vi.fn(),
      onWeekNavigate: vi.fn(),
      onViewChange: vi.fn(),
      onGoToToday: vi.fn(),
    };
    render(
      <PostsCalendar
        events={[]}
        date={new Date(2030, 5, 2)}
        view="week"
        showViewSwitcher
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

  function weekEvent(): DetailedCalendarEvent {
    return calendarEvent({
      id: 'e1',
      start: new Date('2030-06-03T10:00:00.000Z'),
      end: new Date('2030-06-03T10:00:00.000Z'),
    });
  }

  // Day columns only, scoped to the week grid: the toolbar's view switcher
  // is a role="group" too, and it must never count as a day.
  function visibleColumns(): Element[] {
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) return [];
    return [...grid.querySelectorAll('[role="group"][aria-label]:not([inert])')];
  }

  beforeEach(() => {
    vi.mocked(useI18n).mockReturnValue({ t: realT('en'), locale: 'en', setLocale: vi.fn() });
  });

  afterEach(() => {
    vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() });
  });

  it('shows the month caption and the week range underneath', () => {
    renderWeek();
    expect(screen.getByText('June 2030')).toBeInTheDocument();
    expect(screen.getByText('Week of 2 – 8 Jun')).toBeInTheDocument();
  });

  it('names the week range in Portuguese', () => {
    vi.mocked(useI18n).mockReturnValue({ t: realT('pt'), locale: 'pt', setLocale: vi.fn() });
    renderWeek({ locale: 'pt' });
    expect(screen.getByText('Junho 2030')).toBeInTheDocument();
    expect(screen.getByText('Semana 2 – 8 Jun')).toBeInTheDocument();
  });

  it('moves a week at a time from the toolbar', () => {
    const { onWeekNavigate } = renderWeek();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onWeekNavigate).toHaveBeenCalledWith(new Date(2030, 4, 26));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onWeekNavigate).toHaveBeenCalledWith(new Date(2030, 5, 9));
  });

  it('switches back to the month view from the switcher', () => {
    const { onViewChange } = renderWeek();
    const monthButton = screen.getByRole('button', { name: 'Month' });
    const weekButton = screen.getByRole('button', { name: 'Week' });
    expect(weekButton).toHaveAttribute('aria-pressed', 'true');
    expect(monthButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(monthButton);
    expect(onViewChange).toHaveBeenCalledWith('month');
  });

  it('hides the switcher when the page says so', () => {
    renderWeek({ showViewSwitcher: false });
    expect(screen.queryByRole('button', { name: 'Month' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Week' })).not.toBeInTheDocument();
  });

  // A zero-duration event renders title-only (the lib shows the time range
  // only on chips at least 40px tall); the hour is visible on the time axis
  // the chip sits on.
  it('shows an event chip with its title on its day', () => {
    renderWeek({ events: [weekEvent()] });
    const chip = screen.getByText('Morning post').closest('[data-event-id]');
    expect(chip).not.toBeNull();
  });

  it('navigates to the post detail when its chip is clicked', () => {
    renderWeek({ events: [weekEvent()] });
    fireEvent.click(screen.getByText('Morning post'));
    expect(pushMock).toHaveBeenCalledWith('/posts/e1');
  });

  it('selects the day when its column is clicked', () => {
    const { onSelectDay } = renderWeek();
    const columns = visibleColumns();
    expect(columns).toHaveLength(7);
    fireEvent.click(columns[2]);
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-04');
  });

  it('does not select the day when an event chip is clicked', () => {
    const { onSelectDay } = renderWeek({ events: [weekEvent()] });
    fireEvent.click(screen.getByText('Morning post'));
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('ignores column clicks when muted', () => {
    const { onSelectDay } = renderWeek({ muted: true });
    fireEvent.click(visibleColumns()[2]);
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('shows the secondary Lisbon time zone axis', () => {
    renderWeek();
    expect(screen.getByLabelText(/Lisbon time zone/)).toBeInTheDocument();
  });

  it('does not create an event when empty space is clicked', () => {
    renderWeek();
    fireEvent.click(visibleColumns()[2]);
    expect(screen.queryByText('New event')).toBeNull();
  });
});
