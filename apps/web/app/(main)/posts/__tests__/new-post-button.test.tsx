import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// New post is a link to the recipes hub, not a button that opens an
// explanation: the web app has no create form. The i18n mock returns keys.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { CREATE_POSTS_HREF, NewPostButton } from '../day-section';
import { postsCalendarStrings } from '@/lib/i18n/posts-calendar-i18n';

describe('NewPostButton', () => {
  it('is a link to the recipes hub with the New post label', () => {
    render(<NewPostButton testId="new-post-button" />);
    const link = screen.getByRole('link', { name: 'posts.newPostAction' });
    expect(link).toHaveAttribute('href', CREATE_POSTS_HREF);
    expect(screen.getByTestId('new-post-button')).toBe(link);
  });

  it('keeps the button look and the caller classes on the link', () => {
    render(<NewPostButton className="h-8 min-w-0 shrink px-2 text-xs" />);
    const link = screen.getByRole('link', { name: 'posts.newPostAction' });
    expect(link.className).toContain('h-8');
    expect(link.className).toContain('shrink-0');
    expect(link.className).toContain('whitespace-nowrap');
  });

  it('says the calendar lists what the agent sent, and keeps the locales in sync', () => {
    expect(postsCalendarStrings.pt.posts.subtitle).toBe(
      'Calendário das publicações que o seu agente já mandou pelo MCP.',
    );
    expect(postsCalendarStrings.en.posts.subtitle).toBe(
      'Calendar of the posts your agent already sent through the MCP.',
    );
    expect(Object.keys(postsCalendarStrings.pt.posts).sort()).toEqual(
      Object.keys(postsCalendarStrings.en.posts).sort(),
    );
    for (const key of Object.keys(postsCalendarStrings.pt.posts)) {
      expect(key).not.toMatch(/^mcpOnboard/);
    }
  });
});
