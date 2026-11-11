import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for MetricsFilterSheet and ActiveFilterChips: the badge count,
// the draft (Apply commits, Clear resets, closing discards), the
// Persona Combobox and the Network Select, and the removable chips.
// i18n is mocked; t() returns the key, with {vars} appended when
// interpolated. The Sheet/Combobox/Select primitives are real.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale: 'en',
    setLocale: vi.fn(),
  }));
  return { useI18n, I18nProvider };
});

import {
  MetricsFilterSheet,
  ActiveFilterChips,
  countActive,
  EMPTY_FILTERS,
  FILTER_ALL,
  type MetricsFilterPatch,
} from '../metrics-filters';

// cmdk scrolls the active item into view when the list opens; jsdom
// has no Element.scrollIntoView, so stub it for the Combobox tests.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
// Radix Select calls hasPointerCapture on pointerdown; jsdom has none,
// so the trigger never opens without these stubs.
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

const PERSONAS = [
  { value: 'p-alpha', label: 'Alpha' },
  { value: 'p-beta', label: 'Beta' },
];
const PROVIDERS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
];

function renderSheet(filters: MetricsFilterPatch, onApply: (filters: MetricsFilterPatch) => void): void {
  render(
    <MetricsFilterSheet
      filters={filters}
      onApply={onApply}
      personaOptions={PERSONAS}
      providerOptions={PROVIDERS}
    />,
  );
}

async function openSheet(): Promise<void> {
  fireEvent.click(screen.getByText('metrics.filtersButton'));
  await waitFor(() => expect(screen.getByText('metrics.filtersTitle')).toBeInTheDocument());
}

async function openCombobox(): Promise<void> {
  fireEvent.click(screen.getByRole('combobox', { name: 'metrics.filterPersona' }));
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
}

function checkOpacity(option: HTMLElement, opacity: 'opacity-100' | 'opacity-0'): void {
  const check = option.querySelector('svg');
  expect(check).not.toBeNull();
  const classes = check?.className.baseVal ?? check?.getAttribute('class') ?? '';
  expect(classes).toContain('size-4');
  expect(classes).toContain(opacity);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('countActive', () => {
  it('counts each set filter, and zero when none are set', () => {
    expect(countActive({ personaId: null, provider: null })).toBe(0);
    expect(countActive({ personaId: 'p-alpha', provider: null })).toBe(1);
    expect(countActive({ personaId: null, provider: 'instagram' })).toBe(1);
    expect(countActive({ personaId: 'p-alpha', provider: 'instagram' })).toBe(2);
  });
});

describe('FILTER_ALL', () => {
  it('is the literal "all"', () => {
    expect(FILTER_ALL).toBe('all');
    expect(EMPTY_FILTERS).toEqual({ personaId: null, provider: null });
  });
});

describe('MetricsFilterSheet', () => {
  it('shows the plain Filters label with no badge when nothing is active', () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    const button = screen.getByRole('button', { name: 'metrics.filtersButton' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'metrics.filtersButton');
    expect(button).toHaveTextContent('metrics.filtersButton');
    // No badge at all: a badge would show the count, even a zero.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('shows the active count in the badge and the active label with one filter', () => {
    renderSheet({ personaId: 'p-alpha', provider: null }, vi.fn());
    const button = screen.getByRole('button', { name: 'metrics.filtersActive {"count":1}' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('1');
  });

  it('shows the sheet title and description when opened', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    expect(screen.getByText('metrics.filtersTitle')).toBeInTheDocument();
    expect(screen.getByText('metrics.filtersDescription')).toBeInTheDocument();
  });

  it('shows the applied persona in the combobox and the applied network in the select', async () => {
    renderSheet({ personaId: 'p-alpha', provider: 'instagram' }, vi.fn());
    await openSheet();
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('Alpha');
    expect(screen.getByLabelText('metrics.filterProvider')).toHaveTextContent('Instagram');
  });

  it('shows "Todas" in the combobox when no persona is applied', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('metrics.filterAll');
  });

  it('shows the raw id when the applied persona is not in the options', async () => {
    renderSheet({ personaId: 'unknown-id', provider: null }, vi.fn());
    await openSheet();
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('unknown-id');
  });

  it('searches the combobox and shows the no-results message', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    await openCombobox();
    const input = screen.getByPlaceholderText('metrics.filtersSearchPersona');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText('metrics.filtersNoResults')).toBeInTheDocument());
  });

  it('selecting a persona and applying calls onApply with the persona id, and closes the popover', async () => {
    const onApply = vi.fn();
    renderSheet(EMPTY_FILTERS, onApply);
    await openSheet();
    await openCombobox();
    fireEvent.click(screen.getByText('Alpha'));
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    fireEvent.click(screen.getByText('metrics.filtersApply'));
    expect(onApply).toHaveBeenCalledWith({ personaId: 'p-alpha', provider: null });
  });

  it('selecting "Todas" clears the persona id on apply', async () => {
    const onApply = vi.fn();
    renderSheet({ personaId: 'p-alpha', provider: null }, onApply);
    await openSheet();
    await openCombobox();
    const options = await screen.findAllByRole('option');
    const all = options.find((el) => el.textContent?.includes('metrics.filterAll'));
    expect(all).toBeDefined();
    fireEvent.click(all as HTMLElement);
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    fireEvent.click(screen.getByText('metrics.filtersApply'));
    expect(onApply).toHaveBeenCalledWith({ personaId: null, provider: null });
  });

  it('selecting a network and applying calls onApply with the provider', async () => {
    const onApply = vi.fn();
    renderSheet(EMPTY_FILTERS, onApply);
    await openSheet();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('metrics.filterProvider'));
    const options = await screen.findAllByRole('option');
    const instagram = options.find((el) => el.textContent === 'Instagram');
    expect(instagram).toBeDefined();
    await user.click(instagram as HTMLElement);
    fireEvent.click(screen.getByText('metrics.filtersApply'));
    expect(onApply).toHaveBeenCalledWith({ personaId: null, provider: 'instagram' });
  });

  it('offers "Todas" in the network select', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('metrics.filterProvider'));
    const options = await screen.findAllByRole('option');
    expect(options.some((el) => el.textContent === 'metrics.filterAll')).toBe(true);
  });

  it('Clear resets the draft without applying', async () => {
    const onApply = vi.fn();
    renderSheet({ personaId: 'p-alpha', provider: 'instagram' }, onApply);
    await openSheet();
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('Alpha');
    fireEvent.click(screen.getByText('metrics.clearFilters'));
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('metrics.filterAll');
    expect(screen.getByLabelText('metrics.filterProvider')).toHaveTextContent('metrics.filterAll');
    fireEvent.click(screen.getByText('metrics.filtersApply'));
    expect(onApply).toHaveBeenCalledWith({ personaId: null, provider: null });
  });

  it('closing without Apply discards the draft', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    await openCombobox();
    fireEvent.click(screen.getByText('Alpha'));
    // Close the Sheet with its X button, without applying.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('metrics.filtersTitle')).toBeNull());
    await openSheet();
    expect(screen.getByRole('combobox', { name: 'metrics.filterPersona' })).toHaveTextContent('metrics.filterAll');
  });

  it('marks the selected persona with a visible check and the others with a hidden one', async () => {
    renderSheet({ personaId: 'p-alpha', provider: null }, vi.fn());
    await openSheet();
    await openCombobox();
    const options = await screen.findAllByRole('option');
    const all = options.find((el) => el.textContent?.includes('metrics.filterAll')) as HTMLElement;
    const alpha = options.find((el) => el.textContent === 'Alpha') as HTMLElement;
    const beta = options.find((el) => el.textContent === 'Beta') as HTMLElement;
    checkOpacity(all, 'opacity-0');
    checkOpacity(alpha, 'opacity-100');
    checkOpacity(beta, 'opacity-0');
  });

  it('marks "Todas" with a visible check when no persona is applied', async () => {
    renderSheet(EMPTY_FILTERS, vi.fn());
    await openSheet();
    await openCombobox();
    const options = await screen.findAllByRole('option');
    const all = options.find((el) => el.textContent?.includes('metrics.filterAll')) as HTMLElement;
    const alpha = options.find((el) => el.textContent === 'Alpha') as HTMLElement;
    checkOpacity(all, 'opacity-100');
    checkOpacity(alpha, 'opacity-0');
  });
});

describe('ActiveFilterChips', () => {
  it('removes one filter and clears all', () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(
      <ActiveFilterChips
        filters={[
          { key: 'personaId', label: 'Alpha' },
          { key: 'provider', label: 'Instagram' },
        ]}
        onRemove={onRemove}
        onClearAll={onClearAll}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'metrics.filtersRemoveFilter {"label":"Alpha"}' }));
    expect(onRemove).toHaveBeenCalledWith('personaId');
    fireEvent.click(screen.getByText('metrics.clearFilters'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
