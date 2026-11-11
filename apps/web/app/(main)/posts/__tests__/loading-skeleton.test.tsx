import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// Tests for the posts loading skeletons (CalendarLoadingSkeleton,
// CardsLoadingSkeleton). Assertions pin the rendered shape — bar counts
// and class tokens — so a class or count change fails here, not silently.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { CalendarLoadingSkeleton, CardsLoadingSkeleton } from '../loading-skeleton';

describe('CalendarLoadingSkeleton', () => {
  it('renders the 5-week grid with the month shape and the side panel', () => {
    const { container } = render(<CalendarLoadingSkeleton weeks={5} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('posts.loadingPosts')).toBeInTheDocument();

    const calendar = container.querySelector('[data-skeleton-calendar]');
    expect(calendar).not.toBeNull();
    expect(calendar?.className).toContain('rounded-xl');
    expect(calendar?.className).toContain('bg-card');
    expect(calendar?.querySelector('.w-32')).not.toBeNull();
    expect(calendar?.querySelector('.flex.gap-1')).not.toBeNull();
    expect(calendar?.querySelectorAll('.size-10')).toHaveLength(2);
    expect(calendar?.querySelector('.w-16')).not.toBeNull();
    expect(calendar?.querySelectorAll('.h-4')).toHaveLength(7);

    const days = container.querySelectorAll('[data-skeleton-day]');
    expect(days).toHaveLength(35);
    expect(days[0]?.className).toContain('h-20');
    expect(days[0]?.className).toContain('opacity-60');
    expect(days[0]?.className).toContain('pt-1');
    expect(container.querySelectorAll('[data-skeleton-day-number]')).toHaveLength(35);
    expect(container.querySelector('[data-skeleton-day-number]')?.className).toContain('rounded-full');

    const panel = container.querySelector('[data-skeleton-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.w-64')).not.toBeNull();
    const panelCards = panel?.querySelectorAll('.h-36') ?? [];
    expect(panelCards).toHaveLength(2);
    expect(panelCards[0]?.className).toContain('rounded-xl');

    // Every bar carries the pulse shape (1 title + 3 nav + 7 weekday +
    // 35 day cells + 1 panel title + 2 panel cards).
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(49);
  });

  it('renders 42 day cells for a 6-week month', () => {
    const { container } = render(<CalendarLoadingSkeleton weeks={6} />);
    expect(container.querySelectorAll('[data-skeleton-day]')).toHaveLength(42);
    expect(container.querySelectorAll('[data-skeleton-day-number]')).toHaveLength(42);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(56);
  });
});

describe('CardsLoadingSkeleton', () => {
  it('renders the title bar and six cards', () => {
    const { container } = render(<CardsLoadingSkeleton />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('posts.loadingPosts')).toBeInTheDocument();
    expect(container.querySelector('.w-48')).not.toBeNull();
    const cards = container.querySelectorAll('.h-36');
    expect(cards).toHaveLength(6);
    expect(cards[0]?.className).toContain('rounded-xl');
    expect(cards[0]?.className).toContain('opacity-60');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(7);
  });
});
