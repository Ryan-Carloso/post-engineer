import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// The calendar has no create form. New post opens the explanation, and
// the card is the first-visit onboard. The i18n mock returns keys.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { McpOnboardCard, McpOnboardDialog, NewPostButton } from '../mcp-onboard';
import { CREATE_POSTS_HREF, MCP_ONBOARD_SEEN_KEY, useMcpOnboardStore } from '@/lib/mcp-onboard';
import { postsCalendarStrings } from '@/lib/i18n/posts-calendar-i18n';

function renderOnboard() {
  return render(
    <>
      <NewPostButton testId="new-post-button" />
      <McpOnboardCard />
      <McpOnboardDialog />
    </>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(MCP_ONBOARD_SEEN_KEY);
  useMcpOnboardStore.setState({ isOpen: false, cardVisible: false });
});

describe('MCP-first copy', () => {
  it('says the screen does not create the post and the agent sends it through the MCP', () => {
    expect(postsCalendarStrings.pt.posts.newPostAction).toBe('Novo post');
    expect(postsCalendarStrings.en.posts.newPostAction).toBe('New post');
    expect(postsCalendarStrings.pt.posts.mcpOnboardLead).toMatch(/não cria/);
    expect(postsCalendarStrings.pt.posts.mcpOnboardLead).toMatch(/MCP first/);
    expect(postsCalendarStrings.pt.posts.mcpOnboardBody).toMatch(/servidor MCP/);
    expect(postsCalendarStrings.en.posts.mcpOnboardLead).toMatch(/does not create/);
    expect(postsCalendarStrings.en.posts.mcpOnboardLead).toMatch(/MCP-first/);
    expect(postsCalendarStrings.en.posts.mcpOnboardBody).toMatch(/MCP server/);
    expect(postsCalendarStrings.pt.posts.mcpOnboardStep3).toMatch(/MCP/);
    expect(postsCalendarStrings.en.posts.mcpOnboardStep3).toMatch(/MCP/);
    expect(Object.keys(postsCalendarStrings.pt.posts).sort()).toEqual(Object.keys(postsCalendarStrings.en.posts).sort());
  });
});

describe('McpOnboard', () => {
  it('shows the card on the first visit and hides it after Got it', async () => {
    const user = userEvent.setup();
    renderOnboard();
    const card = await screen.findByTestId('mcp-onboard-card');
    expect(within(card).getByText('posts.mcpOnboardLead')).toBeInTheDocument();
    expect(within(card).getByText('posts.mcpOnboardStep1')).toBeInTheDocument();
    expect(within(card).getByText('posts.mcpOnboardStep2')).toBeInTheDocument();
    expect(within(card).getByText('posts.mcpOnboardStep3')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'posts.mcpOnboardDismiss' }));
    expect(screen.queryByTestId('mcp-onboard-card')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(MCP_ONBOARD_SEEN_KEY)).toBe('1');
  });

  it('keeps the card hidden once the visit was dismissed', async () => {
    window.localStorage.setItem(MCP_ONBOARD_SEEN_KEY, '1');
    renderOnboard();
    await waitFor(() => {
      expect(useMcpOnboardStore.getState().cardVisible).toBe(false);
    });
    expect(screen.queryByTestId('mcp-onboard-card')).not.toBeInTheDocument();
  });

  it('opens the explanation from New post and remembers a dismiss', async () => {
    const user = userEvent.setup();
    renderOnboard();
    await user.click(screen.getByTestId('new-post-button'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('posts.mcpOnboardLead')).toBeInTheDocument();
    expect(within(dialog).getByText('posts.mcpOnboardBody')).toBeInTheDocument();
    expect(within(dialog).getByText('posts.mcpOnboardStep1')).toBeInTheDocument();
    expect(within(dialog).getByText('posts.mcpOnboardStep2')).toBeInTheDocument();
    expect(within(dialog).getByText('posts.mcpOnboardStep3')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'posts.mcpOnboardSetup' })).toHaveAttribute('href', CREATE_POSTS_HREF);
    await user.click(within(dialog).getByRole('button', { name: 'posts.mcpOnboardDismiss' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(MCP_ONBOARD_SEEN_KEY)).toBe('1');
    expect(screen.queryByTestId('mcp-onboard-card')).not.toBeInTheDocument();
  });

  it('remembers the visit when the setup link is used', async () => {
    const user = userEvent.setup();
    renderOnboard();
    await user.click(screen.getByTestId('new-post-button'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('link', { name: 'posts.mcpOnboardSetup' }));
    expect(window.localStorage.getItem(MCP_ONBOARD_SEEN_KEY)).toBe('1');
    expect(useMcpOnboardStore.getState().isOpen).toBe(false);
  });

  it('remembers the visit when the dialog is closed with Escape', async () => {
    const user = userEvent.setup();
    renderOnboard();
    await user.click(screen.getByTestId('new-post-button'));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(MCP_ONBOARD_SEEN_KEY)).toBe('1');
  });
});
