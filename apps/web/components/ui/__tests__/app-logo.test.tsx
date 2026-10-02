import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppLogo from '@/components/ui/app-logo';

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

describe('AppLogo', () => {
  it('renders the brand logo image', () => {
    render(<AppLogo />);
    const img = screen.getByTestId('app-logo');
    expect(img).toHaveAttribute('src', '/logo.png');
    expect(img).toHaveAttribute('alt', 'Post Engineer');
  });

  it('applies the requested size', () => {
    render(<AppLogo size={28} />);
    const img = screen.getByTestId('app-logo');
    expect(img).toHaveAttribute('width', '28');
    expect(img).toHaveAttribute('height', '28');
  });
});
