import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CalendarUnavailableFrame } from '../calendar-load-error-frame';

const enT = (key: string) =>
  (
    {
      'posts.calendarPrevMonth': 'Previous month',
      'posts.calendarNextMonth': 'Next month',
      'posts.calendarGoToToday': 'Go to today',
    } as Record<string, string>
  )[key] ?? key;

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: enT,
  }),
}));

describe('CalendarUnavailableFrame', () => {
  it('renders weekday headers and a compact tinted recovery region without legend', () => {
    render(
      <CalendarUnavailableFrame year={2030} month={5} firstWeekday={0} showLegend={false}>
        <p role="alert">Load failed</p>
      </CalendarUnavailableFrame>,
    );
    expect(document.querySelector('[data-calendar-unavailable-frame] ul')).toBeNull();
    const title = screen.getByText(/June 2030/);
    expect(title.textContent).not.toMatch(/\bof\b/i);
    expect(document.querySelector('[data-calendar-error-chrome]')).not.toBeNull();
    expect(document.querySelectorAll('[data-calendar-error-weekdays] th')).toHaveLength(7);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-error-month-row]')).not.toBeNull();
    const nav = document.querySelector('[data-calendar-error-nav]');
    expect(nav).not.toBeNull();
    expect(nav?.className.split(/\s+/)).toContain('flex-nowrap');
    expect(nav?.closest('[data-calendar-error-month-row]')).not.toBeNull();
    for (const button of within(nav as HTMLElement).getAllByRole('button')) {
      expect(button).toBeDisabled();
      expect(button.className.split(/\s+/)).toContain('saturate-50');
      expect(button.className.split(/\s+/)).toContain('opacity-55');
    }
    const strip = document.querySelector('[data-calendar-load-error]');
    expect(strip?.className).toMatch(/bg-warning/);
    const footprint = document.querySelector('[data-calendar-grid-footprint]');
    expect(footprint?.className).toMatch(/min-h-/);
    expect(footprint?.className.split(/\s+/)).toContain('justify-center');
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
  });
});
