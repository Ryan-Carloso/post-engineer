import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NotFoundView } from '@/components/not-found-view';
import { I18nProvider } from '@/lib/i18n/provider';
import { STORAGE_KEY } from '@/lib/i18n/types';

function renderView(signedIn: boolean): void {
  render(
    <I18nProvider>
      <NotFoundView signedIn={signedIn} />
    </I18nProvider>,
  );
}

function linkHrefs(): string[] {
  return screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
}

describe('NotFoundView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('offers account creation, the docs and the landing page when signed out', () => {
    renderView(false);

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Ver documentação' })).toHaveAttribute(
      'href',
      '/api-documentation.txt',
    );
    expect(screen.getByRole('link', { name: 'Voltar para a página inicial' })).toHaveAttribute(
      'href',
      '/landing',
    );
    expect(linkHrefs()).toEqual(['/login', '/api-documentation.txt', '/landing']);
    expect(screen.getByText(/Crie uma conta para começar a publicar/)).toBeInTheDocument();
  });

  it('offers the dashboard instead of sign-up when signed in', () => {
    renderView(true);

    expect(screen.getByRole('link', { name: 'Ir para o painel' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Criar conta' })).not.toBeInTheDocument();
    expect(linkHrefs()).toEqual(['/', '/api-documentation.txt', '/landing']);
    expect(linkHrefs()).not.toContain('/login');
    expect(screen.getByText(/Volte para o seu painel/)).toBeInTheDocument();
    expect(screen.queryByText(/Crie uma conta/)).not.toBeInTheDocument();
  });

  it('keeps the account pitch out of the signed-in English copy', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'en');
    renderView(true);

    expect(await screen.findByText(/Head back to your dashboard/)).toBeInTheDocument();
    expect(screen.queryByText(/Create an account/)).not.toBeInTheDocument();
  });

  it('renders the English copy when the stored locale is en', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'en');
    renderView(false);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'View docs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to landing' })).toBeInTheDocument();
  });
});
