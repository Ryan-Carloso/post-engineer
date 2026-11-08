import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../theme-toggle';

const labels = { group: 'Theme', light: 'Light', dark: 'Dark', system: 'System' };

describe('ThemeToggle', () => {
  it('marks only the current choice as pressed', () => {
    render(<ThemeToggle value="dark" onChange={vi.fn()} labels={labels} />);
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });

  it('reports the clicked choice', () => {
    const onChange = vi.fn();
    render(<ThemeToggle value="system" onChange={onChange} labels={labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('disables every option while disabled', () => {
    render(<ThemeToggle value="system" onChange={vi.fn()} labels={labels} disabled />);
    for (const name of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
