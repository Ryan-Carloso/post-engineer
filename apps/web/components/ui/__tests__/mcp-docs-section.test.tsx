import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import McpDocsSection from '@/components/ui/mcp-docs-section';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';

// Mutable locale so tests can render the component in either language.
let mockLocale: 'en' | 'pt' = 'en';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'apiKeys.needHelp': 'Need help?',
    'apiKeys.installPromptTitle': 'Install prompt',
    'apiKeys.docsHelpMessage': 'I need help',
    'apiKeys.copy': 'Copy',
    'apiKeys.docsCopied': 'Copied!',
    'apiKeys.toolsTitle': 'Available tools',
    'apiKeys.toolsSubtitle': 'Tools your agent gets.',
    'apiKeys.docsSecurityNote': 'Keep your key secret.',
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      // Getter so tests can flip mockLocale between renders.
      get locale() {
        return mockLocale;
      },
      setLocale: vi.fn(),
    }),
  };
});

const KEY = 'pe_live_abcdef1234567890abcdef1234567890';

describe('McpDocsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'en';
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '15551234567');
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
    render(<McpDocsSection apiKey={null} />);

    // Every user-facing string is asserted: the i18n keys are part of the
    // rendered contract, so blanking a key must fail the suite.
    expect(screen.getByText('Install prompt')).toBeInTheDocument();
    expect(screen.getByText('Available tools')).toBeInTheDocument();
    expect(screen.getByText('Tools your agent gets.')).toBeInTheDocument();
    expect(screen.getByText('Keep your key secret.')).toBeInTheDocument();
    expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy');
    const help = screen.getByRole('link', { name: 'Need help?' });
    expect(help).toHaveAttribute('href', expect.stringContaining('https://wa.me/15551234567'));
    // The help link carries the localized support message.
    expect(help).toHaveAttribute('href', expect.stringContaining('text=I%20need%20help'));
  });

  it('keeps the tools grid collapsed by default so the prompt stays the focus', () => {
    render(<McpDocsSection apiKey={null} />);
    const tools = screen.getByTestId('mcp-tools');
    expect(tools.tagName).toBe('DETAILS');
    expect(tools).not.toHaveAttribute('open');
    expect(tools).toContainElement(screen.getByTestId('mcp-tools-grid'));
    expect(within(tools).getByText('Available tools').closest('summary')).not.toBeNull();
  });

  it('hides the WhatsApp help link when the support number is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', undefined);
    render(<McpDocsSection apiKey={null} />);

    expect(screen.getByText('Install prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-docs-help-cta')).toBeNull();
  });

  it('renders the tools grid with the 16 intent tools and the actions of each', () => {
    render(<McpDocsSection apiKey={null} />);

    const grid = screen.getByTestId('mcp-tools-grid');
    expect(grid).toBeInTheDocument();
    // Each card renders its tool id in the bold mono paragraph, in registry
    // order — asserting the id itself (not just grid text) so a blanked id
    // fails. The 16 tools are the MCP server's surface (issue #566).
    const ids = [...grid.querySelectorAll('p.font-bold')].map((p) => p.textContent);
    expect(ids).toEqual([
      'generate_video',
      'video_tasks',
      'cancel_video',
      'personas',
      'persona_media',
      'voices',
      'accounts',
      'schedules',
      'posts',
      'insights',
      'experiments',
      'media',
      'billing',
      'prompts',
      'check_script',
      'publish_video',
    ]);
    // The actions of an action tool sit under its name; generate_video and cancel_video have none.
    const personas = [...grid.querySelectorAll('p.font-bold')].find((p) => p.textContent === 'personas')?.parentElement;
    expect(personas?.textContent).toContain('list · get · create · update · delete');
    const cancel = [...grid.querySelectorAll('p.font-bold')].find((p) => p.textContent === 'cancel_video')?.parentElement;
    expect(cancel?.querySelectorAll('p')).toHaveLength(2);
    for (const descKey of [
      'apiKeys.toolDescGenerateVideo',
      'apiKeys.toolDescVideoTasks',
      'apiKeys.toolDescCancelVideo',
      'apiKeys.toolDescPersonas',
      'apiKeys.toolDescPersonaMedia',
      'apiKeys.toolDescVoices',
      'apiKeys.toolDescAccounts',
      'apiKeys.toolDescSchedules',
      'apiKeys.toolDescPosts',
      'apiKeys.toolDescInsights',
      'apiKeys.toolDescExperiments',
      'apiKeys.toolDescMedia',
      'apiKeys.toolDescBilling',
      'apiKeys.toolDescPrompts',
      'apiKeys.toolDescCheckScript',
      'apiKeys.toolDescPublishVideo',
    ]) {
      expect(within(grid).getByText(descKey)).toBeInTheDocument();
    }
  });

  it('shows and copies the localized prompt with the placeholder when there is no key', async () => {
    for (const locale of ['en', 'pt'] as const) {
      mockLocale = locale;
      const { unmount } = render(<McpDocsSection apiKey={null} />);
      const expected = buildInstallPrompt(locale, null);
      expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(expected);

      fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      expect(window.navigator.clipboard.writeText).toHaveBeenLastCalledWith(expected);
      expect(await screen.findByText('Copied!')).toBeInTheDocument();
      unmount();
    }
  });

  it('shows and copies the prompt with a created key filled in', async () => {
    render(<McpDocsSection apiKey={KEY} />);
    const expected = buildInstallPrompt('en', KEY);
    expect(expected).toContain(KEY);
    expect(screen.getByTestId('mcp-install-prompt').textContent).toBe(expected);

    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(expected);
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('resets the copy button label after the confirmation timeout', async () => {
    vi.useFakeTimers();
    try {
      render(<McpDocsSection apiKey={null} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      });
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copied!');

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy');
    } finally {
      vi.useRealTimers();
    }
  });
});
