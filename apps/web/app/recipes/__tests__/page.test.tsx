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
    'recipes.githubPrsTitle': 'GitHub PRs become videos',
    'recipes.githubPrsObjective':
      'Turn your GitHub pull requests into persona videos.',
    'recipes.copyPrompt': 'Copy prompt',
    'recipes.copiedPrompt': 'Copied!',
    'recipes.kindRecipe': 'Recipe',
    'recipes.kindPrompt': 'Prompt',
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

  it('lists the GitHub PRs prompt with its objective and copyable prompt text', () => {
    render(<RecipesPage />);
    expect(
      screen.getByRole('heading', { name: 'GitHub PRs become videos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Turn your GitHub pull requests into persona videos.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Turn this GitHub pull request into one persona video/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/validate_script with your script/),
    ).toBeInTheDocument();
  });

  it('labels entries by kind, not by sequence number', () => {
    render(<RecipesPage />);
    expect(screen.getByText('Recipe')).toBeInTheDocument();
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
    expect(screen.queryByText('02')).not.toBeInTheDocument();
  });

  it('copies the GitHub PRs prompt to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<RecipesPage />);
    screen.getByRole('button', { name: 'Copy prompt' }).click();
    expect(writeText).toHaveBeenCalledOnce();
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain('generate_persona_video');
    expect(prompt).toContain('validate_script');
    expect(prompt).toContain('60–200 words');
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
