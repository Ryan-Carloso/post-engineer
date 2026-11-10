import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CalendarUnavailableFrame } from '../calendar-load-error-frame';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) =>
      (
        {
          'posts.calendarPrevMonth': 'Previous month',
          'posts.calendarNextMonth': 'Next month',
          'posts.calendarGoToToday': 'Go to today',
        } as Record<string, string>
      )[key] ?? key,
  }),
}));

describe('CalendarUnavailableFrame', () => {
  it('renders weekday headers and a tinted recovery region without day buttons', () => {
    render(
      <CalendarUnavailableFrame year={2030} month={5} firstWeekday={0}>
        <p role="alert">Load failed</p>
      </CalendarUnavailableFrame>,
    );
    expect(screen.getByText(/June 2030/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-calendar-unavailable-frame] th')).toHaveLength(7);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    const nav = document.querySelector('[data-calendar-error-nav]');
    expect(nav).not.toBeNull();
    for (const button of within(nav as HTMLElement).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    const strip = document.querySelector('[data-calendar-load-error]');
    expect(strip?.className).toMatch(/bg-warning/);
    expect(document.querySelector('[data-calendar-grid-footprint]')?.className).toMatch(/min-h-/);
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
  });
});
