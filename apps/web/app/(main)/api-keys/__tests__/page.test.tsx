import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/components/ui/api-keys-section', () => ({
  default: () => <div data-testid="api-keys-section" />,
}));

vi.mock('@/components/ui/mcp-docs-section', () => ({
  default: () => <div data-testid="mcp-docs-section" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'apiKeys.heroTitle': 'Integrate Post Engineer with AI agents',
    'apiKeys.heroSubtitle': 'Use our MCP server.',
    'apiKeys.heroTagline': 'Build, automate, create.',
    'apiKeys.heroTaglineSub': 'Your content, powered by AI.',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      locale: 'en',
      setLocale: vi.fn(),
    }),
  };
});

import ApiKeysPage from '../page';

function renderPage(): void {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<ApiKeysPage />, { wrapper });
}

describe('/api-keys page', () => {
  it('renders the page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'API Keys' })).toBeInTheDocument();
  });

  it('renders the api keys management section', () => {
    renderPage();
    expect(screen.getByTestId('api-keys-section')).toBeInTheDocument();
  });

  it('renders the MCP docs section with install prompt', () => {
    renderPage();
    expect(screen.getByTestId('mcp-docs-section')).toBeInTheDocument();
  });
});
