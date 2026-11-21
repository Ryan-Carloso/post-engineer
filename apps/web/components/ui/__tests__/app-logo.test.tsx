import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppLogo from '@/components/ui/app-logo';

const capturedImageProps: Record<string, unknown>[] = vi.hoisted(() => []);

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => {
    capturedImageProps.push(props as Record<string, unknown>);
    return <img alt={props.alt} {...props} />;
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
    render(<AppLogo className="rounded-lg" />);
    const img = screen.getByTestId('app-logo');
    expect(img).toHaveClass('rounded-lg');
    expect(img).not.toHaveClass('rounded-2xl');
  });

  it('does not preload the logo by default', () => {
    capturedImageProps.length = 0;
    render(<AppLogo />);
    expect(capturedImageProps).toHaveLength(1);
    expect(capturedImageProps[0]).not.toHaveProperty('priority');
  });

  it('renders a branded initials fallback when the image fails to load', () => {
    render(<AppLogo size={32} />);
    fireEvent.error(screen.getByTestId('app-logo'));
    const fallback = screen.getByTestId('app-logo-fallback');
    expect(fallback).toHaveAttribute('aria-label', 'Post Engineer');
    expect(fallback).toHaveTextContent('PE');
    expect(screen.queryByTestId('app-logo')).toBeNull();
  });
});
