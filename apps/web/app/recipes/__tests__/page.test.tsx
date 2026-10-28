import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/site-footer', () => ({
  default: () => <div data-testid="site-footer" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'recipes.title': 'Recipes',
    'recipes.subtitle': 'Copy-ready recipes for the Post Engineer MCP server.',
    'recipes.dailyNewsTitle': 'Daily news becomes a video',
    'recipes.dailyNewsObjective':
      'Turn one news story of the day into one persona video.',
    'recipes.viewRecipe': 'View recipe',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      locale: 'en',
      setLocale: vi.fn(),
    }),
  };
});

import RecipesPage from '../page';

describe('/recipes page', () => {
  it('renders the page title and subtitle', () => {
    render(<RecipesPage />);
    expect(screen.getByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
    expect(
      screen.getByText('Copy-ready recipes for the Post Engineer MCP server.'),
    ).toBeInTheDocument();
  });

  it('lists the daily-news recipe with its objective and doc link', () => {
    render(<RecipesPage />);
    expect(
      screen.getByRole('heading', { name: 'Daily news becomes a video' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Turn one news story of the day into one persona video.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View recipe/ });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
    );
  });
});
