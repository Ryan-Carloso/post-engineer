import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'recipes.title': 'Prompts',
    'recipes.subtitle':
      'Persona videos, published by your agent. MCP-first: create your key, install the MCP, and send the post.',
    'recipes.whyMcpTitle': 'Why MCP-first?',
    'recipes.whyMcpRoutinesTitle': 'Routines',
    'recipes.whyMcpRoutinesBody': 'Say it once, the agent repeats it.',
    'recipes.whyMcpAutomationTitle': 'Automation',
    'recipes.whyMcpAutomationBody': 'Ask your agent, the post shows up.',
    'recipes.stepKeyTitle': 'Create your API key',
    'recipes.stepKeyHint': 'It connects your agent to your account.',
    'recipes.stepSetupTitle': 'Send the setup prompt to your agent',
    'recipes.stepSetupHint': 'Paste it into your agent.',
    'recipes.stepRecipesTitle': 'Public prompts',
    'recipes.stepRecipesHint': 'Copy a prompt and paste it into your agent.',
    'recipes.signInCta': 'Sign in or create an account',
    'recipes.signInHint': 'Sign in to create your API key.',
    'apiKeys.copyPrompt': 'Copy prompt',
    'apiKeys.docsCopied': 'Copied!',
    'userPrompts.stepTitle': 'Your prompts',
    'userPrompts.stepHint': 'Write your own prompts.',
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

vi.mock('../components/my-prompts-section', () => ({
  default: () => <div data-testid="my-prompts-section" />,
}));

vi.mock('../components/public-prompts-section', () => ({
  default: () => <div data-testid="public-prompts-section" />,
}));

vi.mock('@/components/ui/api-keys-section', () => ({
  default: ({ onKeyCreated }: { onKeyCreated?: () => void }) => (
    <button type="button" data-testid="api-keys-section" onClick={() => onKeyCreated?.()}>
      create key
    </button>
  ),
}));

import RecipesPage from '../page';
import { ViewerProvider } from '../viewer-context';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';

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
    expect(screen.getByRole('heading', { level: 1, name: 'Prompts' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Persona videos, published by your agent. MCP-first: create your key, install the MCP, and send the post.',
      ),
    ).toBeInTheDocument();
  });

  it('explains why MCP-first between the hero and step 1', () => {
    renderHub(true);
    const heading = screen.getByRole('heading', { level: 2, name: 'Why MCP-first?' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Routines')).toBeInTheDocument();
    expect(screen.getByText('Say it once, the agent repeats it.')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('Ask your agent, the post shows up.')).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 });
    const step1 = screen.getByRole('heading', { name: 'Create your API key' });
    expect(hero.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(step1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('lays out numbered steps in order: key, setup, recipes, then your prompts', () => {
    renderHub(true);
    const steps = screen.getAllByRole('region');
    expect(steps.map((step) => step.getAttribute('aria-labelledby'))).toEqual([
      'hub-step-1',
      'hub-step-2',
      'hub-step-3',
      'hub-step-4',
    ]);
    expect(within(steps[3]).getByRole('heading', { name: 'Your prompts' })).toBeInTheDocument();
    expect(within(steps[3]).getByTestId('my-prompts-section')).toBeInTheDocument();
    expect(within(steps[3]).getByText('4')).toBeInTheDocument();
    expect(within(steps[0]).getByRole('heading', { name: 'Create your API key' })).toBeInTheDocument();
    expect(within(steps[0]).getByText('It connects your agent to your account.')).toBeInTheDocument();
    expect(within(steps[0]).getByText('1')).toBeInTheDocument();
    expect(
      within(steps[1]).getByRole('heading', { name: 'Send the setup prompt to your agent' }),
    ).toBeInTheDocument();
    expect(within(steps[1]).getByText('Paste it into your agent.')).toBeInTheDocument();
    expect(within(steps[1]).getByText('2')).toBeInTheDocument();
    expect(within(steps[2]).getByRole('heading', { name: 'Public prompts' })).toBeInTheDocument();
    expect(within(steps[2]).getByText('Copy a prompt and paste it into your agent.')).toBeInTheDocument();
    expect(within(steps[2]).getByText('3')).toBeInTheDocument();
  });

  it('hides the prompt manager from a visitor who is not signed in, so nothing fetches for them', () => {
    renderHub(false);
    expect(screen.queryByTestId('my-prompts-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your prompts' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
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
      buildInstallPrompt('en'),
    );
  });

  it('keeps the placeholder in the setup prompt after a key is created in step 1', () => {
    renderHub(true);
    fireEvent.click(screen.getByTestId('api-keys-section'));
    const prompt = screen.getByTestId('mcp-install-prompt');
    expect(prompt.textContent).toBe(buildInstallPrompt('en'));
    expect(prompt.textContent).toContain('<MY_API_KEY>');
    expect(prompt.textContent).not.toContain('pe_live_');
  });

  it('scrolls to step 2 and highlights it briefly once a key is created', () => {
    vi.useFakeTimers();
    try {
      const scrollIntoView = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
      renderHub(true);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(screen.getByTestId('hub-step-2')).toHaveAttribute('data-highlighted', 'false');

      fireEvent.click(screen.getByTestId('api-keys-section'));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('hub-step-2'));
      expect(screen.getByTestId('hub-step-2')).toHaveAttribute('data-highlighted', 'true');

      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(screen.getByTestId('hub-step-2')).toHaveAttribute('data-highlighted', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls to step 2 again when a second key is created', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderHub(true);

    fireEvent.click(screen.getByTestId('api-keys-section'));
    fireEvent.click(screen.getByTestId('api-keys-section'));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('dims the steps after the setup prompt until it is copied, and keeps them usable', async () => {
    renderHub(true);
    for (const step of ['hub-step-3', 'hub-step-4']) {
      expect(screen.getByTestId(step)).toHaveAttribute('data-dimmed', 'true');
    }
    expect(screen.getByTestId('hub-step-1')).toHaveAttribute('data-dimmed', 'false');
    expect(screen.getByTestId('hub-step-2')).toHaveAttribute('data-dimmed', 'false');
    expect(screen.getByTestId('public-prompts-section')).toBeInTheDocument();
    expect(screen.getByTestId('my-prompts-section')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
    await screen.findByText('Copied!');

    for (const step of ['hub-step-3', 'hub-step-4']) {
      expect(screen.getByTestId(step)).toHaveAttribute('data-dimmed', 'false');
    }
  });

  it('lists the public prompts from the database in step 3, signed in or not', () => {
    for (const signedIn of [true, false]) {
      const { unmount } = renderHub(signedIn);
      const steps = screen.getAllByRole('region');
      expect(within(steps[2]).getByTestId('public-prompts-section')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Add your prompt' })).not.toBeInTheDocument();
      unmount();
    }
  });
});
