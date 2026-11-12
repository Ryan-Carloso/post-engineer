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

import { useMcpOnboardStore } from '@/lib/mcp-onboard';
import { AccountEmptyState, DayEmptyState, EmptyState } from '../day-section';

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
  it('opens the MCP explanation from New post', async () => {
    useMcpOnboardStore.setState({ isOpen: false, cardVisible: false });
    const user = userEvent.setup();
    render(<AccountEmptyState />);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.accountEmptyHint')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'posts.newPostAction' });
    expect(button.className).toContain('h-9');
    expect(button.className).toContain('shrink-0');
    expect(button.className).toContain('whitespace-nowrap');
    await user.click(button);
    expect(useMcpOnboardStore.getState().isOpen).toBe(true);
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
    const button = screen.getByRole('button', { name: 'posts.newPostAction' });
    expect(button.className).toContain('h-8');
    expect(button.className).toContain('min-w-0');
    expect(button.className).toContain('px-2');
    expect(button.className).toContain('text-xs');
  });

  it('offers New post when one day is empty', () => {
    render(<DayEmptyState reason="day" monthLabel="June 2030" onClearFilters={vi.fn()} />);
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarDayNoneHint')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'posts.newPostAction' });
    expect(button.className).toContain('h-9');
  });
});
