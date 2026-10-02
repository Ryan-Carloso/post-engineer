import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppLogo from '@/components/ui/app-logo';

const capturedImageProps: Record<string, unknown>[] = vi.hoisted(() => []);

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => {
    capturedImageProps.push(props as Record<string, unknown>);
    // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
    return <img {...props} />;
  },
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

  it('lets a caller radius override the base radius', () => {
    // Tailwind resolves conflicting utilities by stylesheet order, not
    // class-attribute order, so a naive string concat would let the base
    // rounded-2xl win over the caller's rounded-lg everywhere.
    render(<AppLogo className="rounded-lg" />);
    const img = screen.getByTestId('app-logo');
    expect(img).toHaveClass('rounded-lg');
    expect(img).not.toHaveClass('rounded-2xl');
  });

  it('does not preload the logo by default', () => {
    // next/image turns `priority` into <link rel="preload"> tags; the mock
    // swallows unknown DOM attrs, so pin at the prop level instead.
    capturedImageProps.length = 0;
    render(<AppLogo />);
    expect(capturedImageProps).toHaveLength(1);
    expect(capturedImageProps[0]).not.toHaveProperty('priority');
  });
});
