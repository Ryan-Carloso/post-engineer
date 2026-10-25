import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { DetailNotFound, DetailSkeleton } from '../detail-chrome';

describe('detail-chrome', () => {
  it('renders the default not-found copy', () => {
    render(<DetailNotFound />);
    expect(screen.getByText('posts.notFound')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/posts');
  });

  it('renders a custom not-found message', () => {
    render(<DetailNotFound message="gone" />);
    expect(screen.getByText('gone')).toBeInTheDocument();
  });

  it('renders the skeleton pulse blocks', () => {
    const { container } = render(<DetailSkeleton />);
    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse .rounded-2xl')).toHaveLength(1);
  });
});

