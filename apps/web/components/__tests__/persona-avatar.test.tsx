import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

vi.mock('@/lib/ui', () => ({
  ImageIcon: () => <span data-testid="icon-image" />,
}));

const mockWarn = vi.fn();
const mockDebug = vi.fn();
const mockClientError = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    debug: (...args: unknown[]) => mockDebug(...args),
  },
}));

vi.mock('@/lib/client-logger', () => ({
  logClientError: (...args: unknown[]) => mockClientError(...args),
}));

import PersonaAvatar from '../persona-avatar';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PersonaAvatar', () => {
  it('shows a skeleton until the photo loads, then reveals it', () => {
    render(<PersonaAvatar photoUrl="https://x.test/p.png" name="Viva Leve" />);

    expect(screen.getByTestId('persona-avatar-skeleton')).toBeInTheDocument();
    expect(screen.getByAltText('Viva Leve')).toHaveClass('opacity-0');

    fireEvent.load(screen.getByAltText('Viva Leve'));

    expect(screen.queryByTestId('persona-avatar-skeleton')).not.toBeInTheDocument();
    expect(screen.getByAltText('Viva Leve')).not.toHaveClass('opacity-0');
  });

  it('shows the skeleton again while the next candidate loads after a failure', () => {
    render(<PersonaAvatar photoUrl="https://x.test/p.png" libraryUrl="https://x.test/l.png" name="Viva Leve" />);

    fireEvent.load(screen.getByAltText('Viva Leve'));
    expect(screen.queryByTestId('persona-avatar-skeleton')).not.toBeInTheDocument();

    fireEvent.error(screen.getByAltText('Viva Leve'));

    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/l.png');
    expect(screen.getByTestId('persona-avatar-skeleton')).toBeInTheDocument();
  });

  it('prefers the avatar over the photo', () => {
    render(<PersonaAvatar avatarUrl="https://x.test/a.png" photoUrl="https://x.test/p.png" name="Viva Leve" />);

    const image = screen.getByAltText('Viva Leve');
    expect(image).toHaveAttribute('src', 'https://x.test/a.png');
  });

  it('falls back to the photo when there is no avatar', () => {
    render(<PersonaAvatar photoUrl="https://x.test/p.png" name="Viva Leve" />);

    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/p.png');
  });

  it('prefers the photo over the library when there is no avatar', () => {
    render(
      <PersonaAvatar photoUrl="https://x.test/p.png" libraryUrl="https://x.test/l.png" name="Viva Leve" />,
    );

    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/p.png');
  });

  it('uses the library when there is no avatar or photo', () => {
    render(<PersonaAvatar libraryUrl="https://x.test/l.png" name="Viva Leve" />);

    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/l.png');
  });

  it('skips an empty avatar URL and uses the library', () => {
    render(
      <PersonaAvatar avatarUrl="" photoUrl="" libraryUrl="https://x.test/l.png" name="Viva Leve" />,
    );
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/l.png');
  });

  it('skips an empty photo URL and uses the library', () => {
    render(<PersonaAvatar photoUrl="" libraryUrl="https://x.test/l.png" name="Viva Leve" />);
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/l.png');
  });

  it('ignores an empty library URL the same as a missing one', () => {
    render(<PersonaAvatar libraryUrl="" name="Viva Leve" />);

    expect(screen.queryByAltText('Viva Leve')).not.toBeInTheDocument();
    expect(screen.getByText('VL')).toBeInTheDocument();
  });

  it('falls back to two initials with no image at all', () => {
    render(<PersonaAvatar name="Viva Leve" />);

    expect(screen.getByText('VL')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-image')).not.toBeInTheDocument();
    const circle = screen.getByText('VL').parentElement;
    expect(circle?.className.split(/\s+/)).toContain('bg-sunken');
    expect(circle?.className).not.toMatch(/\bbg-destructive\b|\bbg-info\b|\bbg-primary\b/);
  });

  it('keeps initials for a non-Latin name (unicode-aware)', () => {
    render(<PersonaAvatar name="João Silva" />);

    expect(screen.getByText('JS')).toBeInTheDocument();
  });

  it('falls back to the glyph when the name has nothing usable', () => {
    render(<PersonaAvatar name="  " />);

    expect(screen.getByTestId('icon-image')).toBeInTheDocument();
  });

  it('drops a leading @ when building initials from a handle', () => {
    render(<PersonaAvatar name="@resenha.fut" />);

    expect(screen.getByText('RF')).toBeInTheDocument();
  });

  it('degrades to the initials when the image fails to load', () => {
    render(<PersonaAvatar avatarUrl="https://x.test/gone.png" name="Viva Leve" />);

    fireEvent.error(screen.getByAltText('Viva Leve'));

    expect(screen.queryByAltText('Viva Leve')).not.toBeInTheDocument();
    expect(screen.getByText('VL')).toBeInTheDocument();
  });

  it('ignores the library while the avatar is still loading', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://x.test/a.png"
        photoUrl="https://x.test/p.png"
        libraryUrl="https://x.test/l.png"
        name="Viva Leve"
      />,
    );
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/a.png');
  });

  it('falls through to the photo when the avatar fails', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://x.test/a.png"
        photoUrl="https://x.test/p.png"
        libraryUrl="https://x.test/l.png"
        name="Viva Leve"
      />,
    );
    fireEvent.error(screen.getByAltText('Viva Leve'));
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/p.png');
  });

  it('falls through to the library when avatar and photo fail', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://x.test/a.png"
        photoUrl="https://x.test/p.png"
        libraryUrl="https://x.test/l.png"
        name="Viva Leve"
      />,
    );
    fireEvent.error(screen.getByAltText('Viva Leve'));
    fireEvent.error(screen.getByAltText('Viva Leve'));
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/l.png');
  });

  it('shows initials after avatar, photo, and library all fail', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://x.test/a.png"
        photoUrl="https://x.test/p.png"
        libraryUrl="https://x.test/l.png"
        name="Viva Leve"
      />,
    );
    fireEvent.error(screen.getByAltText('Viva Leve'));
    fireEvent.error(screen.getByAltText('Viva Leve'));
    fireEvent.error(screen.getByAltText('Viva Leve'));
    expect(screen.queryByAltText('Viva Leve')).not.toBeInTheDocument();
    expect(screen.getByText('VL')).toBeInTheDocument();
  });

  it('ignores the error of a load aborted by unmount', () => {
    const { unmount } = render(<PersonaAvatar avatarUrl="https://x.test/ok.png" name="Viva Leve" />);
    const image = screen.getByAltText('Viva Leve');
    unmount();

    fireEvent.error(image);

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('warns (not errors) about a failed image with a redacted source', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://abc.supabase.co/storage/v1/object/sign/personas/a.png?token=SECRET"
        name="Viva Leve"
      />,
    );

    fireEvent.error(screen.getByAltText('Viva Leve'));

    expect(mockClientError).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [message, metadata] = mockWarn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('[persona-avatar] avatar image failed to load');
    expect(metadata).toEqual({
      name: 'Viva Leve',
      source: 'https://abc.supabase.co/storage/v1/object/sign/personas/a.png',
    });
    expect(JSON.stringify(metadata)).not.toContain('SECRET');
  });

  it('reports a persona with no avatar source at all', () => {
    render(<PersonaAvatar name="Nia" />);

    expect(mockDebug).toHaveBeenCalledWith('[persona-avatar] no avatar source, showing initials', {
      name: 'Nia',
    });
    expect(mockClientError).not.toHaveBeenCalled();
  });

  it('logs a missing source once per candidate chain', () => {
    const { rerender } = render(<PersonaAvatar name="Nia" />);
    expect(mockDebug).toHaveBeenCalledTimes(1);
    rerender(<PersonaAvatar name="Nia" />);
    expect(mockDebug).toHaveBeenCalledTimes(1);
    rerender(<PersonaAvatar name="Nia" avatarUrl="https://cdn.example/a.png" />);
    expect(mockDebug).toHaveBeenCalledTimes(1);
    rerender(<PersonaAvatar name="Nia" />);
    expect(mockDebug).toHaveBeenCalledTimes(2);
  });
});
