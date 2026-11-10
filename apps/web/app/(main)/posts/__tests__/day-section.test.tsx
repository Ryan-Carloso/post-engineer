import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { CalendarPlus } from 'lucide-react';

//---------------
// Tests for the posts calendar's day-panel states (EmptyState,
// AccountEmptyState, DayEmptyState). The i18n mock returns keys, so
// assertions pin the key and the rendered classes, not copy.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { AccountEmptyState, CREATE_POSTS_HREF, DayEmptyState, EmptyState } from '../day-section';

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
  it('links to the recipes hub to schedule posts', () => {
    render(<AccountEmptyState />);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.accountEmptyHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.accountEmptyAction' });
    expect(link).toHaveAttribute('href', CREATE_POSTS_HREF);
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

  it('offers a compact schedule link when the whole month is empty', () => {
    render(<DayEmptyState reason="month" monthLabel="June 2030" onClearFilters={vi.fn()} />);
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthEmptyHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.schedulePostsAction' });
    expect(link).toHaveAttribute('href', CREATE_POSTS_HREF);
    expect(link.className).toContain('h-8');
    expect(link.className).toContain('min-w-0');
    expect(link.className).toContain('px-2');
    expect(link.className).toContain('text-xs');
  });

  it('offers the schedule link when one day is empty', () => {
    render(<DayEmptyState reason="day" monthLabel="June 2030" onClearFilters={vi.fn()} />);
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarDayNoneHint')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'posts.schedulePostsAction' });
    expect(link).toHaveAttribute('href', CREATE_POSTS_HREF);
    expect(link.className).toContain('h-9');
  });
});
