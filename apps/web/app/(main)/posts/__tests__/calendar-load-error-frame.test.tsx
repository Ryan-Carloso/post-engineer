import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarUnavailableFrame } from '../calendar-load-error-frame';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}));

describe('CalendarUnavailableFrame', () => {
  it('shows only the month title and tinted recovery without grid chrome', () => {
    render(
      <CalendarUnavailableFrame year={2030} month={5}>
        <p role="alert">Load failed</p>
      </CalendarUnavailableFrame>,
    );
    const title = screen.getByText(/June 2030/);
    expect(title.textContent).not.toMatch(/\bof\b/i);
    expect(document.querySelector('[data-calendar-unavailable-frame] ul')).toBeNull();
    expect(document.querySelector('[data-calendar-error-nav]')).toBeNull();
    expect(document.querySelector('[data-calendar-error-weekdays]')).toBeNull();
    expect(document.querySelector('[data-calendar-grid-footprint]')).toBeNull();
    const strip = document.querySelector('[data-calendar-load-error]');
    expect(strip?.className).toMatch(/bg-warning/);
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
  });
});
