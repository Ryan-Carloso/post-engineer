import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }),
}));

import MainLoading from '../loading';
import PostsLoading from '../posts/loading';
import PersonaLoading from '../persona/loading';

describe('route loading boundaries', () => {
  it('renders the generic page skeleton with its card grid for main routes', () => {
    const { container } = render(<MainLoading />);
    const skeleton = container.querySelector('[data-page-loading-skeleton]');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton).toHaveAttribute('aria-live', 'polite');
    const cards = container.querySelectorAll('[data-skeleton-card]');
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card).toHaveClass('skeleton-shimmer');
    }
  });

  it('renders the calendar skeleton for the posts route', () => {
    const { container } = render(<PostsLoading />);
    expect(screen.getByText('posts.loadingPosts')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-skeleton-day]')).toHaveLength(35);
  });

  it('renders the persona skeleton for the persona route', () => {
    const { container } = render(<PersonaLoading />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('section')).toHaveLength(3);
  });
});
