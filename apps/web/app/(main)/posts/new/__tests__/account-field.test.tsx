import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${JSON.stringify(vars)})`;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt' as const, setLocale: vi.fn() }),
    I18nProvider,
  };
});

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountCardDisplay: vi.fn(),
}));

import { AccountField } from '../account-field';
import { I18nProvider } from '@/lib/i18n/provider';
import type { AccountOption } from '@/lib/account-options';

const YOUTUBE: AccountOption = { id: 'ch-1', provider: 'youtube', label: 'E2E Channel' };
const INSTAGRAM: AccountOption = { id: 'ig-1', provider: 'instagram', label: '@e2e.insta' };

function renderField(overrides: Partial<Parameters<typeof AccountField>[0]> = {}) {
  const onToggle = vi.fn();
  const props: Parameters<typeof AccountField>[0] = {
    accounts: [YOUTUBE, INSTAGRAM],
    providers: ['youtube', 'instagram'],
    selected: {},
    loading: false,
    error: false,
    issue: null,
    disabled: false,
    onToggle,
    emptyReason: 'none',
    ...overrides,
  };
  const utils = render(
    <I18nProvider>
      <AccountField {...props} />
    </I18nProvider>,
  );
  return { ...utils, onToggle, props };
}

describe('AccountField', () => {
  it('renders the provider groups with labels, counts and selected state', () => {
    renderField({ selected: { youtube: ['ch-1'] } });
    expect(screen.getByText('composer.accountsLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.accountsHint')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('E2E Channel')).toBeInTheDocument();
    expect(screen.getByText('@e2e.insta')).toBeInTheDocument();
    const selects = screen.getAllByTestId('account-card-select');
    expect(selects).toHaveLength(2);
    expect(selects[0]).toBeChecked();
    expect(selects[1]).not.toBeChecked();
    expect(screen.getAllByText('1')).toHaveLength(2);
  });

  it('calls onToggle with the provider and id when a card is clicked', () => {
    const { onToggle } = renderField();
    fireEvent.click(screen.getAllByTestId('account-card-select')[1]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('instagram', 'ig-1');
  });

  it('hides the checkboxes while disabled', () => {
    renderField({ disabled: true, selected: { youtube: ['ch-1'] } });
    expect(screen.queryByTestId('account-card-select')).not.toBeInTheDocument();
    expect(screen.getByText('E2E Channel')).toBeInTheDocument();
  });

  it('shows skeleton cards while loading', () => {
    const { container } = renderField({ loading: true });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
    expect(screen.queryByText('E2E Channel')).not.toBeInTheDocument();
  });

  it('shows the load error instead of the accounts', () => {
    renderField({ error: true });
    expect(screen.getByText('composer.accountsLoadError')).toBeInTheDocument();
    expect(screen.queryByText('E2E Channel')).not.toBeInTheDocument();
  });

  it('shows the empty state with a link to the accounts page', () => {
    renderField({ accounts: [], emptyReason: 'none' });
    expect(screen.getByText('composer.accountsEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.accountsEmptyHint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('shows the image empty state naming the image providers', () => {
    renderField({ accounts: [], emptyReason: 'image' });
    expect(screen.getByText('composer.accountsImageEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.accountsImageHint({"providers":"Instagram, Bluesky, LinkedIn, Threads, Facebook, Pinterest, Telegram"})')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('shows the persona empty state without the accounts link', () => {
    renderField({ accounts: [], emptyReason: 'persona' });
    expect(screen.getByText('composer.accountsBoundEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.accountsBoundEmptyDescription')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'composer.accountsEmptyAction' })).not.toBeInTheDocument();
  });

  it('hides accounts whose provider is not in the provider list', () => {
    renderField({ providers: ['instagram'] });
    expect(screen.queryByText('E2E Channel')).not.toBeInTheDocument();
    expect(screen.queryByText('YouTube')).not.toBeInTheDocument();
    expect(screen.getByText('@e2e.insta')).toBeInTheDocument();
  });

  it('shows the inline issue below the accounts', () => {
    renderField({ issue: 'composer.validationAccounts' });
    expect(screen.getByText('composer.validationAccounts')).toBeInTheDocument();
  });
});
