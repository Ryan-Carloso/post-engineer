import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { I18nProvider } from '@/lib/i18n/provider';
import ThemeSwitcher from '../theme-switcher';

function renderSwitcher() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme">
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    </ThemeProvider>,
  );
}

function stubSystemDark(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    stubSystemDark(false);
  });

  it('defaults to the system choice on the first visit', () => {
    renderSwitcher();
    expect(screen.getByRole('button', { name: /sistema|system/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies the dark class and persists the choice', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /escuro|dark/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /escuro|dark/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes the dark class when switching back to light', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: /escuro|dark/i }));
    fireEvent.click(screen.getByRole('button', { name: /claro|light/i }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('follows the OS preference when the choice is system', () => {
    stubSystemDark(true);
    renderSwitcher();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('restores a stored choice on mount', () => {
    localStorage.setItem('theme', 'dark');
    renderSwitcher();
    expect(screen.getByRole('button', { name: /escuro|dark/i })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement).toHaveClass('dark');
  });
});
