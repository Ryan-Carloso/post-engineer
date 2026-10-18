import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailProgressBar } from '../detail-progress-bar';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }),
}));

describe('DetailProgressBar', () => {
  it('renders the generating label, the percent width, and the stage', () => {
    render(<DetailProgressBar progress={67} stage="audio" />);

    expect(screen.getByText('posts.videoGenerating')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '67%' });
    expect(screen.getByText('audio').tagName).toBe('P');
  });

  it('omits the stage line when there is no stage', () => {
    const { container } = render(<DetailProgressBar progress={0} stage={null} />);
    expect(container.querySelector('p')).toBeNull();
    expect(screen.getByText('posts.videoGenerating')).toBeInTheDocument();
  });
});
