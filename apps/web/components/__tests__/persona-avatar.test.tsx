import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
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

//---------------
// PersonaAvatar — the shared face: avatar first, photo second, initials
// third. It replaced two inline copies (the persona card and the create-post
// picker), so the fallback order is pinned here rather than in either screen.
//---------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PersonaAvatar', () => {
  it('prefers the avatar over the photo', () => {
    render(<PersonaAvatar avatarUrl="https://x.test/a.png" photoUrl="https://x.test/p.png" name="Viva Leve" />);

    const image = screen.getByAltText('Viva Leve');
    expect(image).toHaveAttribute('src', 'https://x.test/a.png');
  });

  it('falls back to the photo when there is no avatar', () => {
    render(<PersonaAvatar photoUrl="https://x.test/p.png" name="Viva Leve" />);

    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://x.test/p.png');
  });

  it('falls back to two initials with no image at all', () => {
    render(<PersonaAvatar name="Viva Leve" />);

    expect(screen.getByText('VL')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-image')).not.toBeInTheDocument();
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

    // "@resenha.fut" -> tokens ["resenha", "fut"] -> "RF".
    expect(screen.getByText('RF')).toBeInTheDocument();
  });

  // A signed Supabase URL expires; a broken one used to leave a blank circle
  // with no diagnostic trail, so the failure must degrade like the fallback.
  it('degrades to the initials when the image fails to load', () => {
    render(<PersonaAvatar avatarUrl="https://x.test/gone.png" name="Viva Leve" />);

    fireEvent.error(screen.getByAltText('Viva Leve'));

    expect(screen.queryByAltText('Viva Leve')).not.toBeInTheDocument();
    expect(screen.getByText('VL')).toBeInTheDocument();
  });

  // An aborted request (unmount / Fast Refresh) fires `error` too: reacting
  // to it logged a false failure AND threw away a photo that was fine.
  it('ignores the error of a load aborted by unmount', () => {
    const { unmount } = render(<PersonaAvatar avatarUrl="https://x.test/ok.png" name="Viva Leve" />);
    const image = screen.getByAltText('Viva Leve');
    unmount();

    fireEvent.error(image);

    expect(mockClientError).not.toHaveBeenCalled();
  });

  //---------------
  // The diagnostics: "no photo" has two very different causes and both used
  // to be silent. The logged source is redacted (a storage URL's query holds
  // the signature token).
  //---------------
  it('reports a failed image with a redacted source', () => {
    render(
      <PersonaAvatar
        avatarUrl="https://abc.supabase.co/storage/v1/object/sign/personas/a.png?token=SECRET"
        name="Viva Leve"
      />,
    );

    fireEvent.error(screen.getByAltText('Viva Leve'));

    expect(mockClientError).toHaveBeenCalledTimes(1);
    const [message, error, metadata] = mockClientError.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(message).toBe('[persona-avatar] avatar image failed to load');
    expect(error).toBeUndefined();
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
});
