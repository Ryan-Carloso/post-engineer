import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import McpDocsSection from '@/components/ui/mcp-docs-section';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';

let mockLocale: 'en' | 'pt' = 'en';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'apiKeys.needHelp': 'Need help?',
    'apiKeys.installPromptTitle': 'Install prompt',
    'apiKeys.docsHelpMessage': 'I need help',
    'apiKeys.copyPrompt': 'Copy prompt',
    'apiKeys.promptKeyNote': 'The prompt never carries your key.',
    'apiKeys.docsCopied': 'Copied!',
    'apiKeys.toolsTitle': 'Available tools',
    'apiKeys.toolsSubtitle': 'Tools your agent gets.',
    'apiKeys.docsSecurityNote': 'Keep your key secret.',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      get locale() {
        return mockLocale;
      },
      setLocale: vi.fn(),
    }),
  };
});

describe('McpDocsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'en';
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the install prompt, tools, security note, and help link', () => {
    render(<McpDocsSection />);

    expect(screen.getByText('Install prompt')).toBeInTheDocument();
    expect(screen.getByText('Available tools')).toBeInTheDocument();
    expect(screen.getByText('Tools your agent gets.')).toBeInTheDocument();
    expect(screen.getByText('Keep your key secret.')).toBeInTheDocument();
    expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy prompt');
    const help = screen.getByRole('link', { name: 'Need help?' });
    expect(help).toHaveAttribute('href', expect.stringContaining('https://wa.me/351962248268'));
    expect(help).toHaveAttribute('href', expect.stringContaining('text=I%20need%20help'));
  });

  it('always renders the help link', () => {
    render(<McpDocsSection />);
    expect(screen.getByTestId('mcp-docs-help-cta')).toHaveAttribute('href', expect.stringContaining('https://wa.me/351962248268'));
    expect(screen.getByTestId('mcp-docs-help-cta')).toHaveAttribute('target', '_blank');
  });

  it('keeps the tools grid collapsed by default so the prompt stays the focus', () => {
    render(<McpDocsSection />);
    const tools = screen.getByTestId('mcp-tools');
    expect(tools.tagName).toBe('DETAILS');
    expect(tools).not.toHaveAttribute('open');
    expect(tools).toContainElement(screen.getByTestId('mcp-tools-grid'));
    expect(within(tools).getByText('Available tools').closest('summary')).not.toBeNull();
  });

  it('renders the tools grid with the 10 intent tools and the actions of each', () => {
    render(<McpDocsSection />);

    const grid = screen.getByTestId('mcp-tools-grid');
    expect(grid).toBeInTheDocument();
    const ids = [...grid.querySelectorAll('p.font-bold')].map((p) => p.textContent);
    expect(ids).toEqual([
      'publish_video',
      'personas',
      'persona_media',
      'accounts',
      'tool_config',
      'schedules',
      'posts',
      'insights',
      'experiments',
      'prompts',
    ]);
    const ACTIONS: Record<string, string> = {
      publish_video: 'from_file · create_upload · complete_upload · publish_upload · publish_existing',
      personas: 'list · get · create · update · delete',
      persona_media: 'get_card · render_prompt',
      accounts: 'list · connect · disconnect · get_persona_publishing · set_persona_publishing · list_boards',
      tool_config: 'get · save',
      schedules: 'list · cancel · get_slot · update_slot_title · delete_slot',
      posts: 'list · get',
      insights: 'post_metrics · last_day · retention_curve · share_link_create · share_link_list · share_link_revoke',
      experiments: 'results',
      prompts: 'list · get · create · update · delete · versions · restore',
    };
    for (const [tool, actions] of Object.entries(ACTIONS)) {
      const card = [...grid.querySelectorAll('p.font-bold')].find((p) => p.textContent === tool)?.parentElement;
      const actionLine = card?.querySelector('p.font-mono:not(.font-bold)')?.textContent ?? '';
      expect(actionLine, `${tool} actions`).toBe(actions);
    }
    for (const descKey of [
      'apiKeys.toolDescPublishVideo',
      'apiKeys.toolDescPersonas',
      'apiKeys.toolDescPersonaMedia',
      'apiKeys.toolDescAccounts',
      'apiKeys.toolDescToolConfig',
      'apiKeys.toolDescSchedules',
      'apiKeys.toolDescPosts',
      'apiKeys.toolDescInsights',
      'apiKeys.toolDescExperiments',
      'apiKeys.toolDescPrompts',
    ]) {
      expect(within(grid).getByText(descKey)).toBeInTheDocument();
    }
  });

  it('shows and copies the localized prompt with the placeholder when there is no key', async () => {
    for (const locale of ['en', 'pt'] as const) {
      mockLocale = locale;
      const { unmount } = render(<McpDocsSection />);
      const expected = buildInstallPrompt(locale);
      expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(expected);

      fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      expect(window.navigator.clipboard.writeText).toHaveBeenLastCalledWith(expected);
      expect(await screen.findByText('Copied!')).toBeInTheDocument();
      unmount();
    }
  });

  it('shows the key note and never embeds a key in the prompt', () => {
    render(<McpDocsSection />);
    expect(screen.getByTestId('mcp-prompt-key-note')).toHaveTextContent('The prompt never carries your key.');
    expect(screen.getByTestId('mcp-install-prompt').textContent).not.toContain('pe_live_');
    expect(screen.getByTestId('mcp-install-prompt').textContent).toContain('<MY_API_KEY>');
  });

  it('reports the copy to the page only after the clipboard write succeeds', async () => {
    const onPromptCopied = vi.fn();
    render(<McpDocsSection onPromptCopied={onPromptCopied} />);
    expect(onPromptCopied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(onPromptCopied).toHaveBeenCalledTimes(1);
  });

  it('does not report a copy when the clipboard write is rejected', async () => {
    const onPromptCopied = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(window.navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    render(<McpDocsSection onPromptCopied={onPromptCopied} />);
    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(onPromptCopied).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('resets the copy button label after the confirmation timeout', async () => {
    vi.useFakeTimers();
    try {
      render(<McpDocsSection />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      });
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copied!');

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy prompt');
    } finally {
      vi.useRealTimers();
    }
  });
});
