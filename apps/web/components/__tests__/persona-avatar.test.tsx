import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/ui', () => ({
  ImageIcon: () => <span data-testid="icon-image" />,
}));

import PersonaAvatar from '../persona-avatar';

//---------------
// PersonaAvatar — the shared face: avatar first, photo second, initials
// third. It replaced two inline copies (the persona card and the create-post
// picker), so the fallback order is pinned here rather than in either screen.
//---------------

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
});
