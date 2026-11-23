import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { PostFiltersBar, type PostFilters } from '../post-joins';
import type { AccountOption } from '@/lib/account-options';

const accountOptions: AccountOption[] = [
  { id: 'yt-1', provider: 'youtube', label: 'My YouTube' },
  { id: 'ig-1', provider: 'instagram', label: 'My Instagram' },
];

function makeFilters(overrides: Partial<PostFilters> = {}): PostFilters {
  return {
    provider: 'all',
    account: 'all',
    visibleAccounts: accountOptions,
    hasActiveFilter: false,
    setProvider: vi.fn(),
    setAccount: vi.fn(),
    clear: vi.fn(),
    passes: () => true,
    ...overrides,
  };
}

describe('PostFiltersBar', () => {
  it('renders two shadcn comboboxes and no native select', () => {
    render(<PostFiltersBar filters={makeFilters()} />);

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(document.querySelector('select')).toBeNull();
  });

  it('shows the all-providers and all-accounts labels when nothing is filtered', () => {
    render(<PostFiltersBar filters={makeFilters()} />);

    expect(screen.getByRole('combobox', { name: 'posts.filterProvider' })).toHaveTextContent('posts.allProviders');
    expect(screen.getByRole('combobox', { name: 'posts.filterAccount' })).toHaveTextContent('posts.allAccounts');
  });

  it('calls setProvider with the picked provider', async () => {
    const filters = makeFilters();
    render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'posts.filterProvider' }));
    await user.click(screen.getByRole('option', { name: 'YouTube' }));

    expect(filters.setProvider).toHaveBeenCalledWith('youtube');
  });

  it('calls setAccount with the picked account id', async () => {
    const filters = makeFilters();
    render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'posts.filterAccount' }));
    await user.click(screen.getByRole('option', { name: 'My YouTube' }));

    expect(filters.setAccount).toHaveBeenCalledWith('yt-1');
  });

  it('highlights the provider trigger while a provider filter is active', () => {
    render(<PostFiltersBar filters={makeFilters({ provider: 'youtube', hasActiveFilter: true })} />);

    const trigger = screen.getByRole('combobox', { name: 'posts.filterProvider' });
    expect(trigger.className).toContain('border-primary');
    expect(trigger.className).toContain('bg-info-soft');
  });

  it('disables both triggers when the bar is disabled', () => {
    render(<PostFiltersBar filters={makeFilters()} disabled />);

    for (const trigger of screen.getAllByRole('combobox')) {
      expect(trigger).toBeDisabled();
    }
  });

  it('hides the chevron on both triggers while the bar is disabled', () => {
    render(<PostFiltersBar filters={makeFilters()} disabled />);

    for (const trigger of screen.getAllByRole('combobox')) {
      expect(trigger.className.split(/\s+/)).toContain('[&>svg]:hidden');
    }
  });

  it('shows the clear button only with an active filter and clears on click', async () => {
    const filters = makeFilters({ provider: 'youtube', hasActiveFilter: true });
    const { rerender } = render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'posts.clearFilters' }));
    expect(filters.clear).toHaveBeenCalled();

    rerender(<PostFiltersBar filters={makeFilters()} />);
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).toBeNull();
  });
});
