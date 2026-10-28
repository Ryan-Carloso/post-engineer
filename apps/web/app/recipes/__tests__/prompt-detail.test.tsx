import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/site-footer', () => ({
  default: () => <div data-testid="site-footer" />,
}));

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
      'Copying puts the full prompt on your clipboard. Paste it into your agent — Cursor, Claude, Muse, OpenCode, or any agent — replace the bracketed values, and the agent runs it with the Post Engineer MCP server.',
    'recipes.copyNext':
      'Next: your agent validates the script, then generates and publishes the video. Validation is free; generation costs tokens.',
    'recipes.viewOnGithub': 'View this prompt on GitHub',
    'recipes.backToPrompts': 'Back to prompts',
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
    expect(container.textContent?.toLowerCase()).not.toContain('adhd');
    expect(container.textContent).not.toContain('i-have-adhd');
  });
});
