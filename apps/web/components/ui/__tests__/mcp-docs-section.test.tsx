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

  it('renders the tools grid with all 56 tools', () => {
    render(<McpDocsSection apiKey={null} />);

    const grid = screen.getByTestId('mcp-tools-grid');
    expect(grid).toBeInTheDocument();
    // Each card renders its tool id in the mono paragraph, in registry
    // order — asserting the id itself (not just grid text) so a blanked id
    // fails, including the publish_video_direct card added for direct
    // publishing.
    const ids = [...grid.querySelectorAll('p.font-mono')].map((p) => p.textContent);
    expect(ids).toEqual([
      'list_personas',
      'list_voices',
      'list_cloned_voices',
      'create_cloned_voice',
      'get_cloned_voice',
      'delete_cloned_voice',
      'preview_cloned_voice',
      'preview_house_voice',
      'list_faces',
      'create_persona',
      'update_persona',
      'list_persona_images',
      'add_persona_image',
      'update_persona_image',
      'remove_persona_image',
      'publish_video_direct',
      'create_video_upload',
      'complete_video_upload',
      'publish_uploaded_video',
      'get_token_balance',
      'generate_persona_video',
      'generate_persona_video_batch',
      'validate_script',
      'score_draft',
      'upload_media',
      'check_media',
      'list_prompts',
      'get_prompt',
      'get_video_status',
      'get_video_task_progress',
      'wait_for_video_tasks',
      'list_social_accounts',
      'list_pinterest_boards',
      'get_persona_publishing_accounts',
      'set_persona_publishing_accounts',
      'connect_account',
      'list_schedules',
      'list_posts',
      'cancel_schedule',
      'get_slot',
      'update_slot_title',
      'delete_slot',
      'list_video_generations',
      'get_video_generation',
      'get_post',
      'get_post_metrics',
      'get_youtube_retention_curve',
      'create_experiment',
      'list_experiments',
      'add_experiment_pair',
      'get_experiment_results',
      'cancel_video_task',
      'list_token_transactions',
      'get_persona_delete_preview',
      'delete_persona',
      'disconnect_account',
    ]);
    // Each card renders its description through i18n. getByText matches the
    // full element text (not a substring): 'apiKeys.toolDescUpdatePersona'
    // is a prefix of '...UpdatePersonaImage', so a substring assertion
    // would pass vacuously on a blanked key.
    for (const descKey of [
      'apiKeys.toolDescListPersonas',
      'apiKeys.toolDescListVoices',
      'apiKeys.toolDescListFaces',
      'apiKeys.toolDescCreatePersona',
      'apiKeys.toolDescUpdatePersona',
      'apiKeys.toolDescListPersonaImages',
      'apiKeys.toolDescAddPersonaImage',
      'apiKeys.toolDescUpdatePersonaImage',
      'apiKeys.toolDescRemovePersonaImage',
      'apiKeys.toolDescPublishVideoDirect',
      'apiKeys.toolDescGetTokenBalance',
      'apiKeys.toolDescGeneratePersonaVideo',
      'apiKeys.toolDescGeneratePersonaVideoBatch',
      'apiKeys.toolDescValidateScript',
      'apiKeys.toolDescGetVideoStatus',
      'apiKeys.toolDescGetVideoTaskProgress',
      'apiKeys.toolDescWaitForVideoTasks',
      'apiKeys.toolDescListSocialAccounts',
      'apiKeys.toolDescListPinterestBoards',
      'apiKeys.toolDescGetPersonaPublishingAccounts',
      'apiKeys.toolDescSetPersonaPublishingAccounts',
      'apiKeys.toolDescConnectAccount',
      'apiKeys.toolDescListSchedules',
      'apiKeys.toolDescListPosts',
      'apiKeys.toolDescCancelSchedule',
      'apiKeys.toolDescGetSlot',
      'apiKeys.toolDescUpdateSlotTitle',
      'apiKeys.toolDescDeleteSlot',
      'apiKeys.toolDescListVideoGenerations',
      'apiKeys.toolDescGetVideoGeneration',
      'apiKeys.toolDescListTokenTransactions',
      'apiKeys.toolDescGetPersonaDeletePreview',
      'apiKeys.toolDescDeletePersona',
      'apiKeys.toolDescDisconnectAccount',
      'apiKeys.toolDescListPrompts',
      'apiKeys.toolDescGetPrompt',
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
