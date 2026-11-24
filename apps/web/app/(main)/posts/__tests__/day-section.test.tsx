import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { CalendarPlus } from 'lucide-react';

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { AccountEmptyState, DayEmptyState, DayListRow, EmptyState } from '../day-section';
import type { PostJoins } from '../post-joins';
import type { ScheduledSlot } from '@/lib/api';
import type { ScheduleConfig } from '@/lib/api';

const rowJoins: PostJoins = {
  scheduleById: new Map([['s1', { id: 's1', personaId: 'p1' } as ScheduleConfig]]),
  personaNameById: new Map([['p1', 'Viva Leve']]),
  personaPhotoById: new Map(),
  accountOptions: [],
  isLoading: false,
  isError: false,
  refetch: () => {},
};

const rowSlot: ScheduledSlot = {
  id: 'u1',
  scheduleId: 's1',
  slotAt: '2030-06-01T10:00:00.000Z',
  status: 'awaiting',
  title: 'Upcoming topic',
  progress: 0,
  stage: null,
  queuePosition: null,
  queueTotal: null,
  retryable: null,
};

describe('DayListRow', () => {
  it('renders one summarized line: time, persona, title and the group chip', () => {
    render(<DayListRow slot={rowSlot} joins={rowJoins} />);

    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    const persona = screen.getByText('Viva Leve');
    expect(persona.className).toContain('uppercase');
    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('posts.groupScheduled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.cardOpenDetail' })).toHaveAttribute('href', '/posts/u1');
  });

  it('shows the generating stage with its progress in the chip', () => {
    render(<DayListRow slot={{ ...rowSlot, status: 'generating', progress: 62 }} joins={rowJoins} />);

    expect(screen.getByText('posts.statusGenerating · 62%')).toBeInTheDocument();
  });

  it('shows the unknown-title fallback on a slot with no title', () => {
    render(<DayListRow slot={{ ...rowSlot, title: null }} joins={rowJoins} />);

    expect(screen.getByText('posts.unknownTitle')).toBeInTheDocument();
  });

  it('shows the no-persona fallback when the schedule has no persona', () => {
    const voiceoverJoins: PostJoins = {
      ...rowJoins,
      scheduleById: new Map([['s1', { id: 's1', personaId: null } as ScheduleConfig]]),
    };
    render(<DayListRow slot={rowSlot} joins={voiceoverJoins} />);

    expect(screen.getByText('posts.noPersona')).toBeInTheDocument();
  });

  it('shows the removed-persona fallback when the schedule names a persona that is gone', () => {
    const removedJoins: PostJoins = {
      ...rowJoins,
      personaNameById: new Map(),
    };
    render(<DayListRow slot={rowSlot} joins={removedJoins} />);

    expect(screen.getByText('posts.personaFallback')).toBeInTheDocument();
  });

  it('renders no thumbnail video: a summarized row, not a card', () => {
    const { container } = render(
      <DayListRow slot={{ ...rowSlot, status: 'published', publishedAt: '2030-06-01T10:05:00.000Z', taskId: 'task-9' }} joins={rowJoins} />,
    );

    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('posts.groupPublished')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the roomy layout without an action by default', () => {
    const { container } = render(<EmptyState icon={CalendarPlus} title="Title" description="Hint" />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Hint')).toBeInTheDocument();
    const state = container.querySelector('[data-empty-state]');
    expect(state).not.toBeNull();
    expect(state?.className).toContain('gap-2');
    expect(state?.className).toContain('px-6');
    expect(state?.className).toContain('py-10');
    expect(state?.querySelector('.size-10')).not.toBeNull();
  });

  it('renders the compact layout with an action', () => {
    const { container } = render(
      <EmptyState
        compact
        icon={CalendarPlus}
        title="Title"
        description="Hint"
        action={<button type="button">Do it</button>}
      />,
    );
    const state = container.querySelector('[data-empty-state]');
    expect(state).not.toBeNull();
    expect(state?.className).toContain('gap-1.5');
    expect(state?.className).toContain('px-4');
    expect(state?.className).toContain('py-6');
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
  });
});

describe('AccountEmptyState', () => {
  it('links New post to the recipes hub', () => {
    render(<AccountEmptyState />);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.accountEmptyHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.newPostAction' });
    expect(link).toHaveAttribute('href', '/recipes');
    expect(link.className).toContain('h-9');
    expect(link.className).toContain('shrink-0');
    expect(link.className).toContain('whitespace-nowrap');
  });
});

describe('DayEmptyState', () => {
  it('offers to clear the filters when a filter empties the day', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(<DayEmptyState reason="filter" monthLabel="June 2030" onClearFilters={onClearFilters} />);
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.filterEmptyHint')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'posts.clearFilters' });
    expect(button.className).toContain('gap-1.5');
    await user.click(button);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('offers a compact New post button when the whole month is empty', () => {
    render(<DayEmptyState reason="month" monthLabel="June 2030" onClearFilters={vi.fn()} />);
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthEmptyHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.newPostAction' });
    expect(link).toHaveAttribute('href', '/recipes');
    expect(link.className).toContain('h-8');
    expect(link.className).toContain('min-w-0');
    expect(link.className).toContain('px-2');
    expect(link.className).toContain('text-xs');
  });

  it('offers New post when one day is empty', () => {
    render(<DayEmptyState reason="day" monthLabel="June 2030" onClearFilters={vi.fn()} />);
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarDayNoneHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.newPostAction' });
    expect(link).toHaveAttribute('href', '/recipes');
    expect(link.className).toContain('h-9');
  });
});
