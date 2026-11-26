import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { groupAccountsByProvider, PostAccountsSection } from '../post-accounts-section';
import type { AccountCardData } from '../account-cards';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() }),
}));

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountCardDisplay: vi.fn(),
}));

const LUNA_ACCOUNTS: AccountCardData[] = [
  { id: 'th-1', type: 'threads', name: '@luna.summer9' },
  { id: 'did:plc:luna', type: 'bluesky', name: 'lunasummer.bsky.social', handle: '@lunasummer.bsky.social' },
  { id: 'ig-1', type: 'instagram', name: '@luna.summer9' },
  { id: 'ch-1', type: 'youtube', name: 'Luna Summer', email: 'luna@example.com' },
];

describe('groupAccountsByProvider', () => {
  it('groups accounts per network in the shared provider order and drops empty networks', () => {
    const groups = groupAccountsByProvider(LUNA_ACCOUNTS);
    expect(groups.map((group) => group.provider)).toEqual(['youtube', 'instagram', 'bluesky', 'threads']);
    expect(groups.map((group) => group.accounts.map((account) => account.id))).toEqual([['ch-1'], ['ig-1'], ['did:plc:luna'], ['th-1']]);
  });

  it('keeps every account of a network in one group', () => {
    const groups = groupAccountsByProvider([
      { id: 'ig-1', type: 'instagram', name: '@a' },
      { id: 'ch-1', type: 'youtube', name: 'A' },
      { id: 'ig-2', type: 'instagram', name: '@b' },
    ]);
    expect(groups).toEqual([
      { provider: 'youtube', accounts: [{ id: 'ch-1', type: 'youtube', name: 'A' }] },
      { provider: 'instagram', accounts: [{ id: 'ig-1', type: 'instagram', name: '@a' }, { id: 'ig-2', type: 'instagram', name: '@b' }] },
    ]);
  });
});

describe('PostAccountsSection', () => {
  it('renders nothing when the post targets no account', () => {
    const { container } = render(<PostAccountsSection accounts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('puts same-named accounts under the heading and brand tile of their own network', () => {
    render(<PostAccountsSection accounts={LUNA_ACCOUNTS} />);

    const instagram = screen.getByRole('group', { name: 'accounts.instagramLabel' });
    expect(within(instagram).getByRole('heading', { name: 'accounts.instagramLabel' })).toBeInTheDocument();
    expect(within(instagram).getByTestId('provider-brand-instagram')).toBeInTheDocument();
    expect(within(instagram).getByText('@luna.summer9')).toBeInTheDocument();
    expect(within(instagram).getByText('(1)')).toBeInTheDocument();

    const threads = screen.getByRole('group', { name: 'accounts.threadsLabel' });
    expect(within(threads).getByTestId('provider-brand-threads')).toBeInTheDocument();
    expect(within(threads).getByText('@luna.summer9')).toBeInTheDocument();
    expect(within(threads).queryByTestId('provider-brand-instagram')).toBeNull();
  });

  it('lists the networks in the shared provider order', () => {
    render(<PostAccountsSection accounts={LUNA_ACCOUNTS} />);
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'accounts.youtubeLabel',
      'accounts.instagramLabel',
      'accounts.blueskyLabel',
      'accounts.threadsLabel',
    ]);
  });
});
