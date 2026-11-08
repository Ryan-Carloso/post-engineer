import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n/provider';

// next-themes reads the stored choice from localStorage in its state
// initializer: the server sees no choice ("system") while the first client
// render already sees the stored one. The mock reproduces that split so the
// test fails if ThemeSwitcher renders the stored value before mount.
const themeState = vi.hoisted(() => ({ theme: 'system' }));
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: vi.fn() }),
}));

import ThemeSwitcher from '../theme-switcher';

const tree = () => (
  <I18nProvider>
    <ThemeSwitcher />
  </I18nProvider>
);

const pressed = (container: ParentNode): string[] =>
  [...container.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label') ?? '');

afterEach(() => {
  themeState.theme = 'system';
});

describe('ThemeSwitcher hydration', () => {
  it('renders the server value, disabled, when the stored choice is unknown (SSR)', () => {
    themeState.theme = 'dark';
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree());

    expect(pressed(container)).toEqual(['Sistema']);
    expect([...container.querySelectorAll('button')].every((b) => b.hasAttribute('disabled'))).toBe(true);
  });

  it('hydrates server markup without a mismatch when a dark choice is stored, then shows it', async () => {
    themeState.theme = 'system';
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree());
    document.body.appendChild(container);
    // Client side: the stored choice is now visible to the theme hook.
    themeState.theme = 'dark';
    const recoverableErrors: unknown[] = [];
    let root: { unmount: () => void } | undefined;
    try {
      root = await act(async () =>
        hydrateRoot(container, tree(), { onRecoverableError: (error) => recoverableErrors.push(error) }),
      );

      expect(recoverableErrors).toEqual([]);
      expect(pressed(container)).toEqual(['Escuro']);
      expect([...container.querySelectorAll('button')].some((b) => b.hasAttribute('disabled'))).toBe(false);
    } finally {
      const mounted = root;
      if (mounted !== undefined) act(() => mounted.unmount());
      container.remove();
    }
  });

  it('shows the stored choice on a plain client render', () => {
    themeState.theme = 'light';
    render(tree());
    expect(screen.getByRole('button', { name: 'Claro' })).toHaveAttribute('aria-pressed', 'true');
  });
});
