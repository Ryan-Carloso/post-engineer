import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'recipes.dailyNewsTitle': 'Daily news becomes a video',
    'recipes.dailyNewsObjective':
      'Turn one news story of the day into one persona video.',
    'recipes.kindRecipe': 'Recipe',
    'recipes.dailyNewsStep1': 'For creators who publish one news video a day.',
    'recipes.dailyNewsStep2':
      'It solves picking, scripting, and validating a story without guessing.',
    'recipes.dailyNewsStep3': 'Pick one clear story with a named place.',
    'recipes.dailyNewsStep4':
      'Write hook first, CTA last, then validate before any token is spent.',
    'recipes.dailyNewsStep5':
      'Generate one video and publish it where you asked.',
    'recipes.dailyNewsDeliver1': 'One persona video from one story.',
    'recipes.dailyNewsDeliver2':
      'A validated script: 60–200 words, hook first, CTA last.',
    'recipes.dailyNewsDeliver3': 'A published post on your connected accounts.',
    'recipes.dailyNewsExampleInput':
      'Riverside city opens park after ten-year build.',
    'recipes.dailyNewsExampleOutput':
      'Hook, two body segments, CTA — 88 words, 4 segments.',
    'recipes.stepsTitle': 'What this prompt does',
    'recipes.deliversTitle': 'What you get',
    'recipes.examplesTitle': 'Example',
    'recipes.exampleInputLabel': 'Input',
    'recipes.exampleOutputLabel': 'Output',
    'recipes.copyFullPrompt': 'Copy this prompt',
    'recipes.copiedPrompt': 'Copied!',
    'recipes.copyExplanation':
      'Copying puts the full prompt on your clipboard. Paste it into your agent — Cursor, Claude, Muse, OpenCode, or any agent — and it asks you what it needs, then runs with the Post Engineer MCP server.',
    'recipes.copyNext':
      'Next: your agent validates the script, then generates and publishes the video. Validation is free; generation costs tokens.',
    'recipes.viewOnGithub': 'View this prompt on GitHub',
    'recipes.backToPrompts': 'Back to prompts',
    'recipes.fullSetupTitle': 'Full setup becomes videos',
    'recipes.fullSetupObjective':
      'Connect accounts, create a persona, validate the script, and publish your first video.',
    'recipes.fullSetupStep1': 'Connect your accounts.',
    'recipes.fullSetupStep2':
      'It walks accounts, persona, a validated script, and real publishing in one flow.',
    'recipes.fullSetupDeliver1': 'Every account connected and a persona created.',
    'recipes.fullSetupExampleInput': 'Starting with zero accounts and no persona.',
    'recipes.placeSpotlightTitle': 'Place spotlight becomes a video',
    'recipes.placeSpotlightObjective':
      'Turn one real place into one persona video with photos of the place itself on screen, validated before any token is spent.',
    'recipes.placeSpotlightStep1':
      'For creators who spotlight places: bars, hotels, neighbourhoods, shops, cafés.',
    'recipes.placeSpotlightStep2':
      'It finds the facts and the real photos of the place with your own search tool: Tavily, Exa, or another.',
    'recipes.placeSpotlightStep3':
      'Every photo passes a mechanical check before it enters the script; a refused photo drops out without hurting the video.',
    'recipes.placeSpotlightStep4':
      'Write hook first, CTA last, then validate before any token is spent.',
    'recipes.placeSpotlightStep5':
      'Generate one video: the photos come in as cards with name, address, and price.',
    'recipes.placeSpotlightDeliver1': 'One persona video with up to 6 real photos of the place.',
    'recipes.placeSpotlightDeliver2':
      'A validated script: 60–200 words, hook first, CTA last.',
    'recipes.placeSpotlightDeliver3':
      'On-screen cards with the place name, the address, and one detail like a price.',
    'recipes.placeSpotlightExampleInput':
      'The downtown café that opened in 1913 and serves olive oil cake.',
    'recipes.placeSpotlightExampleOutput':
      'Hook about the door price, two bodies with the place photos, CTA — 4 photos, one card each.',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      locale: 'en',
      setLocale: vi.fn(),
    }),
  };
});

import { getPrompt } from '../prompts';
import PromptDetail from '../prompt-detail';

describe('prompt detail page', () => {
  const prompt = getPrompt('daily-news');
  if (prompt === undefined) {
    throw new Error('daily-news prompt entry is missing');
  }

  it('leads with short steps: what it does, why it serves, who it is for', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('heading', { name: 'What this prompt does' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('For creators who publish one news video a day.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'It solves picking, scripting, and validating a story without guessing.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Pick one clear story with a named place.'),
    ).toBeInTheDocument();
  });

  it('shows what you get and an example before the full prompt', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('heading', { name: 'What you get' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('One persona video from one story.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Example' })).toBeInTheDocument();
    expect(
      screen.getByText('Riverside city opens park after ten-year build.'),
    ).toBeInTheDocument();
  });

  it('shows the full prompt and a big copy button with its explanation', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByText(/Turn one top story from today's GNews headlines/),
    ).toBeInTheDocument();
    const copyButton = screen.getByRole('button', {
      name: 'Copy this prompt',
    });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('validate_script');
    expect(copied).toContain('generate_persona_video');
    expect(
      screen.getByText(/Paste it into your agent/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cursor, Claude, Muse, OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/or any agent/)).toBeInTheDocument();
    expect(screen.getByText(/Validation is free/)).toBeInTheDocument();
  });

  it('shows Copied only after the clipboard write resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<PromptDetail prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy this prompt' }));
    expect(
      await screen.findByRole('button', { name: 'Copied!' }),
    ).toBeInTheDocument();
  });

  it('keeps the Copy label when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<PromptDetail prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy this prompt' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    // Let the rejection handler run before asserting the label is unchanged.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.getByRole('button', { name: 'Copy this prompt' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copied!' }),
    ).not.toBeInTheDocument();
  });

  it('keeps GitHub as a small secondary link at the bottom, not the main action', () => {
    render(<PromptDetail prompt={prompt} />);
    const links = screen.getAllByRole('link');
    const githubLink = screen.getByRole('link', {
      name: 'View this prompt on GitHub',
    });
    expect(githubLink).toHaveAttribute(
      'href',
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
    );
    expect(links[links.length - 1]).toBe(githubLink);
  });

  it('never names an internal style skill in user-facing copy', () => {
    const { container } = render(<PromptDetail prompt={prompt} />);
    // The substring check covers any hyphenated internal skill name too.
    expect(container.textContent?.toLowerCase()).not.toContain('adhd');
  });

  it('shows the agent logos next to the copy explanation', () => {
    const { container } = render(<PromptDetail prompt={prompt} />);
    const ids = [...container.querySelectorAll('[data-agent]')].map((el) => el.getAttribute('data-agent'));
    expect(ids).toEqual(['cursor', 'claude', 'opencode']);
  });
});

describe('place-spotlight detail page', () => {
  const prompt = getPrompt('place-spotlight');
  if (prompt === undefined) {
    throw new Error('place-spotlight prompt entry is missing');
  }

  it('renders the place-spotlight title and objective', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('heading', { name: 'Place spotlight becomes a video' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Turn one real place into one persona video with photos of the place itself on screen, validated before any token is spent.',
      ),
    ).toBeInTheDocument();
  });

  it('points the doc link at docs/recipes/place-spotlight.md', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('link', { name: 'View this prompt on GitHub' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/place-spotlight.md',
    );
  });

  it('shows the full prompt with the ordered place flow', () => {
    render(<PromptDetail prompt={prompt} />);
    for (const marker of [
      'Ask me which place',
      'Search the place once',
      'image search',
      'check_media',
      'media overlay',
      'validate_script',
      'generate_persona_video',
    ]) {
      expect(screen.getByText(new RegExp(marker.replace(/[.[\\(\\)|*+?^$]/g, '\\$&')))).toBeInTheDocument();
    }
  });
});

describe('full-setup detail page', () => {
  const prompt = getPrompt('full-setup');
  if (prompt === undefined) {
    throw new Error('full-setup prompt entry is missing');
  }

  it('renders the full-setup title and objective', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('heading', { name: 'Full setup becomes videos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect accounts, create a persona, validate the script, and publish your first video.',
      ),
    ).toBeInTheDocument();
  });

  it('points the doc link at docs/recipes/full-setup.md', () => {
    render(<PromptDetail prompt={prompt} />);
    expect(
      screen.getByRole('link', { name: 'View this prompt on GitHub' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/full-setup.md',
    );
  });

  it('shows the full prompt with the ordered setup flow', () => {
    render(<PromptDetail prompt={prompt} />);
    for (const marker of [
      'list_social_accounts',
      'never repeat, print, or log it',
      'create_persona',
      'get_token_balance',
      'confirm the providers/accounts and the mode (scheduled|asap)',
      'generate_persona_video',
    ]) {
      expect(screen.getByText(new RegExp(marker.replace(/[.[\\(\\)|*+?^$]/g, '\\$&')))).toBeInTheDocument();
    }
  });
});
