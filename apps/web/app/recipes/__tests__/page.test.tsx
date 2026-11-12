import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'recipes.title': 'Get your prompts',
    'recipes.subtitle':
      'Post Engineer is MCP-first. Create your key, install the MCP in your agent, and copy the prompt that sends the post.',
    'recipes.stepKeyTitle': 'Create your API key',
    'recipes.stepKeyHint': 'It connects your agent to your account.',
    'recipes.stepSetupTitle': 'Send the setup prompt to your agent',
    'recipes.stepSetupHint': 'Paste it into your agent.',
    'recipes.stepRecipesTitle': 'Pick a recipe',
    'recipes.stepRecipesHint': 'Copy a prompt and paste it into your agent.',
    'recipes.signInCta': 'Sign in or create an account',
    'recipes.signInHint': 'Sign in to create your API key.',
    'recipes.copyPrompt': 'Copy prompt',
    'recipes.copiedPrompt': 'Copied!',
    'apiKeys.copy': 'Copy',
    'recipes.dailyNewsTitle': 'Daily news becomes a video',
    'recipes.dailyNewsObjective': 'Turn one news story of the day into one persona video.',
    'recipes.placeSpotlightTitle': 'Place spotlight becomes a video',
    'recipes.placeSpotlightObjective': 'Turn one real place into one persona video.',
    'recipes.subjectSpotlightTitle': 'Subject spotlight becomes a video',
    'recipes.subjectSpotlightObjective': 'Turn one concrete subject into one persona video.',
    'recipes.githubPrsTitle': 'GitHub PRs become videos',
    'recipes.githubPrsObjective': 'Turn your GitHub pull requests into persona videos.',
    'recipes.last30DaysTitle': 'Last 30 days become a video',
    'recipes.last30DaysObjective':
      'Turn what happened in your niche in the last 30 days into one persona video.',
    'recipes.multiRedeTitle': 'One week, one video per network',
    'recipes.multiRedeObjective': 'Publish one video per network this week.',
    'recipes.viralShortsTitle': 'A viral video becomes your Short',
    'recipes.viralShortsObjective': 'Learn from the most-viewed video in your niche.',
    'recipes.fullSetupTitle': 'Full setup becomes videos',
    'recipes.kindRecipe': 'Recipe',
    'recipes.kindPrompt': 'Prompt',
    'recipes.openPrompt': 'Open prompt',
    'recipes.addYourPrompt': 'Add your prompt',
    'recipes.addYourPromptHint': 'Got a prompt that works? Send it in.',
  };
  return {
    useI18n: () => ({
      t: (key: string, vars?: Record<string, string | number>) =>
        vars === undefined ? (translations[key] ?? key) : `${key}:${JSON.stringify(vars)}`,
      locale: 'en' as const,
      setLocale: vi.fn(),
    }),
  };
});

// The key manager is a React Query component with its own suite; here it
// only has to hand a created key to the hub.
vi.mock('@/components/ui/api-keys-section', () => ({
  default: ({ onKeyCreated }: { onKeyCreated?: (key: string) => void }) => (
    <button type="button" data-testid="api-keys-section" onClick={() => onKeyCreated?.(CREATED_KEY)}>
      create key
    </button>
  ),
}));

import RecipesPage from '../page';
import { ViewerProvider } from '../viewer-context';
import { PROMPTS } from '../prompts';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';

const CREATED_KEY = 'pe_live_abcdef1234567890abcdef1234567890';

function renderHub(signedIn: boolean) {
  return render(
    <ViewerProvider signedIn={signedIn}>
      <RecipesPage />
    </ViewerProvider>,
  );
}

describe('/recipes prompts hub', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('renders the hub title and subtitle', () => {
    renderHub(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Get your prompts' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Post Engineer is MCP-first. Create your key, install the MCP in your agent, and copy the prompt that sends the post.',
      ),
    ).toBeInTheDocument();
  });

  it('lays out three numbered steps in order: key, setup, recipes', () => {
    renderHub(true);
    const steps = screen.getAllByRole('region');
    expect(steps.map((step) => step.getAttribute('aria-labelledby'))).toEqual([
      'hub-step-1',
      'hub-step-2',
      'hub-step-3',
    ]);
    expect(within(steps[0]).getByRole('heading', { name: 'Create your API key' })).toBeInTheDocument();
    expect(within(steps[0]).getByText('It connects your agent to your account.')).toBeInTheDocument();
    expect(within(steps[0]).getByText('1')).toBeInTheDocument();
    expect(
      within(steps[1]).getByRole('heading', { name: 'Send the setup prompt to your agent' }),
    ).toBeInTheDocument();
    expect(within(steps[1]).getByText('Paste it into your agent.')).toBeInTheDocument();
    expect(within(steps[1]).getByText('2')).toBeInTheDocument();
    expect(within(steps[2]).getByRole('heading', { name: 'Pick a recipe' })).toBeInTheDocument();
    expect(within(steps[2]).getByText('Copy a prompt and paste it into your agent.')).toBeInTheDocument();
    expect(within(steps[2]).getByText('3')).toBeInTheDocument();
  });

  it('shows the key manager to a signed-in visitor', () => {
    renderHub(true);
    expect(screen.getByTestId('api-keys-section')).toBeInTheDocument();
    expect(screen.queryByTestId('recipes-sign-in-cta')).not.toBeInTheDocument();
  });

  it('shows a sign-in call to action to a signed-out visitor, returning to the hub', () => {
    renderHub(false);
    expect(screen.queryByTestId('api-keys-section')).not.toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Sign in or create an account' });
    expect(cta).toHaveAttribute('href', '/login?next=/recipes');
    expect(screen.getByText('Sign in to create your API key.')).toBeInTheDocument();
  });

  it('shows the setup prompt with the placeholder to a signed-out visitor', () => {
    renderHub(false);
    expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(
      buildInstallPrompt('en', null),
    );
  });

  it('fills a key created in step 1 into the setup prompt in step 2', () => {
    renderHub(true);
    expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(
      buildInstallPrompt('en', null),
    );
    fireEvent.click(screen.getByTestId('api-keys-section'));
    expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(
      buildInstallPrompt('en', CREATED_KEY),
    );
    expect(screen.getByTestId('mcp-install-prompt')).toHaveTextContent(CREATED_KEY);
  });

  it('links each card title to its own detail page, not straight to GitHub', () => {
    renderHub(true);
    for (const [name, href] of [
      [/Daily news becomes a video/, '/recipes/daily-news'],
      [/Place spotlight becomes a video/, '/recipes/place-spotlight'],
      [/Subject spotlight becomes a video/, '/recipes/subject-spotlight'],
      [/GitHub PRs become videos/, '/recipes/github-prs'],
      [/Last 30 days become a video/, '/recipes/last-30-days'],
      [/One week, one video per network/, '/recipes/multi-rede'],
      [/A viral video becomes your Short/, '/recipes/viral-shorts'],
      [/Full setup becomes videos/, '/recipes/full-setup'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(screen.getAllByRole('link', { name: /Open prompt/ })).toHaveLength(PROMPTS.length);
    expect(
      screen.queryByText(/Turn this GitHub pull request into one persona video/),
    ).not.toBeInTheDocument();
  });

  it('copies the exact full prompt from each card', async () => {
    renderHub(true);
    for (const prompt of PROMPTS) {
      fireEvent.click(screen.getByTestId(`copy-prompt-${prompt.slug}`));
      expect(window.navigator.clipboard.writeText).toHaveBeenLastCalledWith(prompt.prompt);
    }
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(PROMPTS.length);
    expect(await screen.findAllByRole('button', { name: 'Copied!' })).toHaveLength(PROMPTS.length);
  });

  it('labels entries by kind, not by sequence number', () => {
    renderHub(true);
    expect(screen.getAllByText('Recipe')).toHaveLength(6);
    expect(screen.getAllByText('Prompt')).toHaveLength(2);
    expect(screen.queryByText('01')).not.toBeInTheDocument();
  });

  it('has no search box or kind filter', () => {
    renderHub(true);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('offers a secondary "Add your prompt" link to the prompt_request template after the grid', () => {
    const { container } = renderHub(true);
    const link = screen.getByRole('link', { name: 'Add your prompt' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Ryan-Carloso/post-engineer/issues/new?template=prompt_request.md',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const grid = container.querySelector('ul');
    if (!grid) throw new Error('prompt grid not rendered');
    // The link sits outside and after the card grid, never inside it.
    expect(grid.contains(link)).toBe(false);
    expect(
      grid.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
