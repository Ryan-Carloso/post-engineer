import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

vi.mock('@/hooks/use-now', () => ({
  useNow: vi.fn(() => null),
  useToday: vi.fn(() => new Date(2030, 4, 17)),
}));

import { useNow } from '@/hooks/use-now';
import { PostsSidebar } from '../posts-sidebar';
import type { PersonaCalendar } from '../persona-filter';

const CALENDARS: PersonaCalendar[] = [
  { id: 'p1', name: 'HabitLoom', color: '#22c55e' },
  { id: 'p2', name: 'Daily Dose', color: '#f59e0b' },
  { id: null, name: 'No persona', color: '#94a3b8' },
];

function renderSidebar(overrides: Partial<Parameters<typeof PostsSidebar>[0]> = {}) {
  const onSelectDay = vi.fn();
  const onTogglePersona = vi.fn();
  const utils = render(
    <PostsSidebar
      calendars={CALENDARS}
      hiddenIds={new Set()}
      onTogglePersona={onTogglePersona}
      currentDate={new Date(2030, 5, 1)}
      weekStartsOn={0}
      locale="en"
      onSelectDay={onSelectDay}
      {...overrides}
    />,
  );
  return { ...utils, onSelectDay, onTogglePersona };
}

beforeEach(() => {
  vi.mocked(useNow).mockReturnValue(null);
});

describe('PostsSidebar', () => {
  it('renders the mini calendar, the persona rows, the month view row and the second-timezone box', () => {
    renderSidebar();
    expect(document.querySelector('[data-slot="mini-calendar"]')).not.toBeNull();
    expect(screen.getByText('posts.sidebarCalendars')).toBeInTheDocument();
    expect(screen.getByText('HabitLoom')).toBeInTheDocument();
    expect(screen.getByText('Daily Dose')).toBeInTheDocument();
    expect(screen.getByText('No persona')).toBeInTheDocument();
    expect(screen.getByText('posts.sidebarViews')).toBeInTheDocument();
    expect(screen.getByText('posts.sidebarViewMonth')).toBeInTheDocument();
    expect(screen.getByText('posts.sidebarSecondTimezone')).toBeInTheDocument();
    expect(screen.getByText('posts.sidebarLisbon')).toBeInTheDocument();
  });

  it('shows month as the only view: no week, day or year row, and no platform label', () => {
    const { container } = renderSidebar();
    expect(screen.queryByText('posts.sidebarViewWeek')).toBeNull();
    expect(screen.queryByText('posts.sidebarViewDay')).toBeNull();
    expect(screen.queryByText('posts.sidebarViewYear')).toBeNull();
    expect(container.textContent).not.toMatch(/só web|só mobile|web only|mobile only/i);
  });

  it('is hidden below the lg breakpoint', () => {
    const { container } = renderSidebar();
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain('hidden');
    expect(aside?.className).toContain('lg:block');
  });

  it('toggles a persona off when its switch is clicked', async () => {
    const user = userEvent.setup();
    const { onTogglePersona } = renderSidebar();
    await user.click(screen.getByRole('switch', { name: 'HabitLoom' }));
    expect(onTogglePersona).toHaveBeenCalledWith('p1');
    expect(onTogglePersona).toHaveBeenCalledTimes(1);
  });

  it('shows a hidden persona’s switch as off', () => {
    renderSidebar({ hiddenIds: new Set(['p2']) });
    expect(screen.getByRole('switch', { name: 'Daily Dose' })).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('switch', { name: 'HabitLoom' })).toHaveAttribute('data-state', 'checked');
  });

  it('selects the picked day in the mini calendar', async () => {
    const user = userEvent.setup();
    const { onSelectDay } = renderSidebar();
    const mini = document.querySelector('[data-slot="mini-calendar"]') as HTMLElement;
    const dayButton = within(mini)
      .getAllByRole('button')
      .find((button) => button.textContent === '17');
    expect(dayButton).toBeDefined();
    await user.click(dayButton as HTMLElement);
    expect(onSelectDay).toHaveBeenCalledWith('2030-06-17');
    expect(onSelectDay).toHaveBeenCalledTimes(1);
  });

  it('hides the calendars section when there are no personas', () => {
    renderSidebar({ calendars: [] });
    expect(screen.queryByText('posts.sidebarCalendars')).toBeNull();
    expect(document.querySelector('[data-slot="mini-calendar"]')).not.toBeNull();
  });

  it('shows dashes, never a clock time, while the clock is not known yet', () => {
    const { container } = renderSidebar();
    const sidebar = container.querySelector('[data-testid="posts-sidebar"]') as HTMLElement;
    expect(within(sidebar).getAllByText('—')).toHaveLength(2);
    expect(within(sidebar).queryByText(/\d{1,2}:\d{2}/)).toBeNull();
  });

  it('shows the zone times once the clock is known', () => {
    vi.mocked(useNow).mockReturnValue(new Date('2030-06-01T12:34:00.000Z'));
    renderSidebar();
    expect(screen.getByText('01:34 PM')).toBeInTheDocument();
  });
});
