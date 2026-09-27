import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ApiKeysSection from '@/components/ui/api-keys-section';

vi.mock('@/lib/api', () => ({
  useApiKeysQuery: vi.fn(),
  useCreateApiKeyMutation: vi.fn(),
  useRevokeApiKeyMutation: vi.fn(),
  usePersonasQuery: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'apiKeys.title': 'API Keys',
    'apiKeys.subtitle': 'Manage programmatic access.',
    'apiKeys.generateButton': '+ Generate new API Key',
    'apiKeys.nameLabel': 'Key name',
    'apiKeys.namePlaceholder': 'e.g. MCP Server',
    'apiKeys.createSuccess': 'Key generated successfully!',
    'apiKeys.warningCopyOnce': 'Copy this key now.',
    'apiKeys.copied': 'Copied!',
    'apiKeys.copyKey': 'Copy key',
    'apiKeys.noKeys': 'No API keys generated yet.',
    'apiKeys.emptyTitle': 'No API keys yet',
    'apiKeys.emptyDesc': 'Generate your first key to connect AI agents and MCP servers.',
    'apiKeys.emptyCta': 'Generate API key',
    'apiKeys.lastUsed': 'Last used: {date}',
    'apiKeys.neverUsed': 'Never used',
    'apiKeys.revoked': 'Revoked',
    'apiKeys.active': 'Active',
    'apiKeys.revoke': 'Revoke',
    'apiKeys.revokeConfirm': 'Revoke this key?',
    'apiKeys.create': 'Create key',
    'apiKeys.cancel': 'Cancel',
    'apiKeys.loadError': 'Could not load API keys.',
    'apiKeys.scopeLabel': 'Personas this key can access',
    'apiKeys.scopeAll': 'All personas (including future ones)',
    'apiKeys.scopeSpecific': 'Only selected personas',
    'apiKeys.scopeAllBadge': 'All personas',
    'apiKeys.scopeCount': '{count} personas',
    'apiKeys.scopePersonasError': 'Could not load personas.',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      locale: 'en',
      setLocale: vi.fn(),
    }),
  };
});

import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
  usePersonasQuery,
} from '@/lib/api';

const PERSONAS = [
  { id: 'persona-1', name: 'Ana', createdAt: '2026-09-18T10:00:00.000Z' },
  { id: 'persona-2', name: 'Beto', createdAt: '2026-09-18T10:00:00.000Z' },
];

function renderSection(): void {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<ApiKeysSection />, { wrapper });
}

describe('ApiKeysSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRevokeApiKeyMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
    vi.mocked(useCreateApiKeyMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
    vi.mocked(usePersonasQuery).mockReturnValue({
      data: PERSONAS,
      isLoading: false,
      isError: false,
    } as never);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('renders the empty state when no keys exist', () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    renderSection();

    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByTestId('api-keys-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No API keys yet')).toBeInTheDocument();
    expect(
      screen.getByText('Generate your first key to connect AI agents and MCP servers.'),
    ).toBeInTheDocument();
  });

  it('opens the create form from the empty state CTA', () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    renderSection();

    fireEvent.click(screen.getByTestId('api-keys-empty-cta'));
    expect(screen.getByTestId('create-api-key-form')).toBeInTheDocument();
  });

  it('shows an empty state in the scope selector when there are no personas', () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    vi.mocked(usePersonasQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    renderSection();

    fireEvent.click(screen.getByTestId('generate-api-key-btn'));
    fireEvent.click(screen.getByTestId('api-key-scope-specific'));

    expect(screen.getByTestId('api-key-scope-empty')).toBeInTheDocument();
    expect(screen.getByTestId('submit-create-key-btn')).toBeDisabled();
  });

  it('creates a key and shows the secret once with copy support', async () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue({
      id: 'key-1',
      name: 'CI Agent',
      key: 'pe_live_abcdef1234567890abcdef1234567890',
      keyPrefix: 'pe_live_abcdef12...',
      createdAt: '2026-09-18T10:00:00.000Z',
    });
    vi.mocked(useCreateApiKeyMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    renderSection();

    fireEvent.click(screen.getByTestId('generate-api-key-btn'));
    fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'CI Agent' } });
    fireEvent.click(screen.getByTestId('submit-create-key-btn'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ name: 'CI Agent', personaIds: null });
    });
    expect(await screen.findByTestId('api-key-created-banner')).toBeInTheDocument();
    expect(screen.getByTestId('raw-api-key-value')).toHaveValue(
      'pe_live_abcdef1234567890abcdef1234567890',
    );

    fireEvent.click(screen.getByTestId('copy-api-key-btn'));
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      'pe_live_abcdef1234567890abcdef1234567890',
    );
  });

  it('lists keys and revokes after confirmation', async () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [
        {
          id: 'key-1',
          name: 'Prod',
          keyPrefix: 'pe_live_prod1234...',
          createdAt: '2026-09-18T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
      isLoading: false,
      isError: false,
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useRevokeApiKeyMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.stubGlobal('confirm', vi.fn(() => true));
    window.confirm = vi.fn(() => true);
    renderSection();

    expect(screen.getByTestId('api-key-row-key-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('revoke-key-btn-key-1'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith('key-1');
    });
    vi.unstubAllGlobals();
  });

  it('renders the loading and error states', () => {    vi.mocked(useApiKeysQuery).mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
  } as never);
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiKeysSection />
    </QueryClientProvider>,
  );
  unmount();

  vi.mocked(useApiKeysQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
  } as never);
  renderSection();
  expect(screen.getByText('Could not load API keys.')).toBeInTheDocument();
  });

  it('creates a scoped key limited to the selected personas', async () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue({
      id: 'key-1',
      name: 'Scoped Agent',
      key: 'pe_live_abcdef1234567890abcdef1234567890',
      keyPrefix: 'pe_live_abcdef12...',
      personaIds: ['persona-1'],
      createdAt: '2026-09-18T10:00:00.000Z',
    });
    vi.mocked(useCreateApiKeyMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    renderSection();

    fireEvent.click(screen.getByTestId('generate-api-key-btn'));
    expect(screen.getByTestId('api-key-scope-all')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('api-key-scope-specific'));
    fireEvent.click(screen.getByTestId('api-key-persona-persona-1'));
    fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'Scoped Agent' } });
    fireEvent.click(screen.getByTestId('submit-create-key-btn'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ name: 'Scoped Agent', personaIds: ['persona-1'] });
    });
    expect(await screen.findByTestId('api-key-created-banner')).toBeInTheDocument();
  });

  it('requires at least one persona when scope is specific', async () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    const mutateAsync = vi.fn();
    vi.mocked(useCreateApiKeyMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    renderSection();

    fireEvent.click(screen.getByTestId('generate-api-key-btn'));
    fireEvent.click(screen.getByTestId('api-key-scope-specific'));
    fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'Scoped Agent' } });

    expect(screen.getByTestId('submit-create-key-btn')).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('displays the persona scope badge on each key row', () => {
    vi.mocked(useApiKeysQuery).mockReturnValue({
      data: [
        {
          id: 'key-1',
          name: 'Full',
          keyPrefix: 'pe_live_full1234...',
          personaIds: null,
          createdAt: '2026-09-18T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
        {
          id: 'key-2',
          name: 'Scoped',
          keyPrefix: 'pe_live_scop1234...',
          personaIds: ['persona-1', 'persona-2'],
          createdAt: '2026-09-18T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
      isLoading: false,
      isError: false,
    } as never);
    renderSection();

    expect(screen.getByTestId('api-key-scope-badge-key-1')).toHaveTextContent('All personas');
    expect(screen.getByTestId('api-key-scope-badge-key-2')).toHaveTextContent('2 personas');
  });
});
