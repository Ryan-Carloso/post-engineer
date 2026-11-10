import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarLoadErrorEmptyState, CalendarUnavailableFrame } from '../calendar-load-error-frame';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}));

describe('CalendarUnavailableFrame', () => {
  it('wraps recovery content in a content-sized dashed card with no grid chrome', () => {
    const onRetry = vi.fn();
    render(
      <CalendarUnavailableFrame>
        <CalendarLoadErrorEmptyState messageKey="posts.loadErrorCalendar" onRetry={onRetry} />
      </CalendarUnavailableFrame>,
    );
    expect(screen.queryByText(/June 2030/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-unavailable-frame] ul')).toBeNull();
    expect(document.querySelector('[data-calendar-error-nav]')).toBeNull();
    expect(document.querySelector('[data-calendar-error-weekdays]')).toBeNull();
    expect(document.querySelector('[data-calendar-grid-footprint]')).toBeNull();
    const panel = document.querySelector('[data-calendar-load-error]');
    expect(panel?.className).toMatch(/border-dashed/);
    expect(panel?.className).toMatch(/bg-card/);
    expect(panel?.className).not.toMatch(/bg-warning/);
    expect(screen.getByRole('alert')).toHaveTextContent('posts.loadErrorCalendar');
    fireEvent.click(screen.getByRole('button', { name: 'posts.loadErrorRetry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
