import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import McpDocsSection from '@/components/ui/mcp-docs-section';

// Mutable locale so tests can render the component in either language and
// compare the generated install prompts.
let mockLocale = 'en';

vi.mock('@/lib/i18n/provider', () => {
  const translations: Record<string, string> = {
    'apiKeys.connectTitle': 'Connect to your AI agent (MCP)',
    'apiKeys.connectSubtitle': 'Follow the steps below.',
    'apiKeys.needHelp': 'Need help?',
    'apiKeys.connectStep1Title': 'Copy your API key',
    'apiKeys.connectStep1Desc': 'Use the key above.',
    'apiKeys.connectStep2Title': 'Add to your MCP configuration',
    'apiKeys.connectStep2Desc': 'Add the server.',
    'apiKeys.connectStep3Title': 'Start using it',
    'apiKeys.connectStep3Desc': 'Done.',
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

describe('McpDocsSection', () => {
  const origWhatsappEnv = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'en';
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = '15551234567';
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    else process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = origWhatsappEnv;
  });

  it('renders the MCP docs with steps and copy button', () => {
    render(<McpDocsSection />);

    expect(screen.getByText('Connect to your AI agent (MCP)')).toBeInTheDocument();
    expect(screen.getByText('Copy your API key')).toBeInTheDocument();
    expect(screen.getByText('Add to your MCP configuration')).toBeInTheDocument();
    expect(screen.getByText('Start using it')).toBeInTheDocument();
    expect(screen.getByTestId('copy-mcp-prompt-btn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Need help?' })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/15551234567'),
    );
  });

  it('hides the WhatsApp help link when the support number is not configured', () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    render(<McpDocsSection />);

    expect(screen.getByText('Connect to your AI agent (MCP)')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-docs-help-cta')).toBeNull();
  });

  it('renders the tools grid with all nineteen tools', () => {
    render(<McpDocsSection />);

    const grid = screen.getByTestId('mcp-tools-grid');
    expect(grid).toBeInTheDocument();
    for (const tool of [
      'list_personas',
      'list_voices',
      'list_faces',
      'create_persona',
      'update_persona',
      'get_token_balance',
      'generate_persona_videos',
      'get_video_status',
      'get_video_task_progress',
      'list_persona_images',
      'add_persona_image',
      'update_persona_image',
      'remove_persona_image',
      'list_social_accounts',
      'connect_account',
      'list_schedules',
      'list_posts',
      'cancel_schedule',
    ]) {
      expect(grid).toHaveTextContent(tool);
    }
  });

  it('copies the install prompt mentioning post-engineer to the clipboard', () => {
    render(<McpDocsSection />);

    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledOnce();
    const prompt = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0][0] as string;
    expect(prompt).toContain('post-engineer');
    expect(prompt).toContain('POST_ENGINEER_API_KEY');
    expect(prompt).toContain('generate_persona_videos');
    expect(prompt).toContain('"command": ["npx", "-y", "post-engineer-mcp"]');
    expect(prompt).toContain('list_personas');
    expect(prompt).toContain('list_voices');
    expect(prompt).toContain('list_faces');
    expect(prompt).toContain('list_social_accounts');
    expect(prompt).toContain('get_token_balance');
    expect(prompt).toContain('cancel_schedule');
    // Batch generation, per-video progress, image library, and account
    // connect must be visible to the agent in the copied prompt.
    expect(prompt).toContain('generate_persona_videos');
    expect(prompt).toContain('get_video_task_progress');
    expect(prompt).toContain('list_persona_images');
    expect(prompt).toContain('add_persona_image');
    expect(prompt).toContain('update_persona_image');
    expect(prompt).toContain('remove_persona_image');
    expect(prompt).toContain('connect_account');
    expect(prompt).toContain('webhookUrl');
    // list_posts lets the agent show upcoming and past posts.
    expect(prompt).toContain('list_posts');
    expect(prompt).toContain('upcoming');
    expect(prompt).toContain('past posts');
    // list_posts documents the limit contract of the MCP tool: the tool's
    // ListPostsSchema defaults limit to 20 (max 500) and the MCP client
    // always sends an explicit ?limit=, so the endpoint's own default (10)
    // never applies to MCP calls. Pin the copy to catch drift.
    expect(prompt).toContain(
      'list_posts: list my upcoming (scheduled) and past posts across all connected accounts (optional limit, default 20, max 500).',
    );
    // generate_persona_videos documents the per-video overrides.
    expect(prompt).toContain('generate_persona_videos');
    expect(prompt).toContain('audioUrl');
    expect(prompt).toContain('overriding the persona voice');
    expect(prompt).toContain('How to work with me');
    expect(prompt).toContain('Never invent a personaId');
    expect(prompt).not.toContain('Clone');
    expect(prompt).not.toContain('apps/mcp/dist/index.js');
    expect(prompt).not.toContain('POST_ENGINEER_API_URL');
    const visiblePrompt = screen.getByTestId('mcp-install-prompt');
    expect(visiblePrompt).toHaveTextContent('post-engineer-mcp');
    expect(visiblePrompt).toHaveTextContent('How to work with me');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('documents the same minimum schedule window in the EN and PT install prompts', () => {
    const prompts: Record<string, string> = {};
    for (const locale of ['en', 'pt'] as const) {
      mockLocale = locale;
      const { unmount } = render(<McpDocsSection />);
      fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      const calls = vi.mocked(window.navigator.clipboard.writeText).mock.calls;
      prompts[locale] = calls[calls.length - 1][0] as string;
      unmount();
    }
    // The generate_persona_videos doc line is the agent's source of truth
    // for the schedule window; EN and PT must agree on the minimum advance
    // (regression: the PT line still advertised the old 24h window).
    // Step 5 of the prompt carries the same window and is pinned too, plus
    // a prompt-wide guard so no 24h copy can slip back in anywhere.
    for (const locale of ['en', 'pt'] as const) {
      expect(prompts[locale], `${locale} prompt`).not.toContain('24h');
      const videoLine = prompts[locale]
        .split('\n')
        .find((line) => line.includes('- generate_persona_videos:'));
      expect(videoLine, `${locale} prompt`).toBeDefined();
      expect(videoLine, `${locale} prompt`).toContain('3h');
      const step5Line = prompts[locale]
        .split('\n')
        .find((line) => line.startsWith('5. '));
      expect(step5Line, `${locale} prompt step 5`).toBeDefined();
      expect(step5Line, `${locale} prompt step 5`).toContain('3h');
    }
  });
});
