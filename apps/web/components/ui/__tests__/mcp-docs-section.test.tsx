import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    // Every user-facing string is asserted: the i18n keys are part of the
    // rendered contract, so blanking a key must fail the suite.
    expect(screen.getByText('Follow the steps below.')).toBeInTheDocument();
    expect(screen.getByText('Copy your API key')).toBeInTheDocument();
    expect(screen.getByText('Use the key above.')).toBeInTheDocument();
    expect(screen.getByText('Add to your MCP configuration')).toBeInTheDocument();
    expect(screen.getByText('Add the server.')).toBeInTheDocument();
    expect(screen.getByText('Start using it')).toBeInTheDocument();
    expect(screen.getByText('Done.')).toBeInTheDocument();
    expect(screen.getByText('Install prompt')).toBeInTheDocument();
    expect(screen.getByText('Available tools')).toBeInTheDocument();
    expect(screen.getByText('Tools your agent gets.')).toBeInTheDocument();
    expect(screen.getByText('Keep your key secret.')).toBeInTheDocument();
    expect(screen.getByTestId('copy-mcp-prompt-btn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Need help?' })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/15551234567'),
    );
    // The help link carries the localized support message.
    expect(screen.getByRole('link', { name: 'Need help?' })).toHaveAttribute(
      'href',
      expect.stringContaining('text=I%20need%20help'),
    );
  });

  it('numbers the steps, highlights the first one, and connects consecutive steps', () => {
    const { container } = render(<McpDocsSection />);

    const badges = container.querySelectorAll('ol span.rounded-full');
    expect(badges).toHaveLength(3);
    expect([...badges].map((badge) => badge.textContent)).toEqual(['1', '2', '3']);
    // Only the first badge carries the dark highlight.
    expect(badges[0].className).toContain('bg-[#101728]');
    expect(badges[1].className).toContain('bg-[#edf0f4]');
    expect(badges[2].className).toContain('bg-[#edf0f4]');
    // A connector renders between steps, never after the last one.
    expect(container.querySelectorAll('ol span[aria-hidden="true"]')).toHaveLength(2);
  });

  it('hides the WhatsApp help link when the support number is not configured', () => {
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    render(<McpDocsSection />);

    expect(screen.getByText('Connect to your AI agent (MCP)')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-docs-help-cta')).toBeNull();
  });

  it('renders the tools grid with all twenty-eight tools', () => {
    render(<McpDocsSection />);

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
      'list_faces',
      'create_persona',
      'update_persona',
      'list_persona_images',
      'add_persona_image',
      'update_persona_image',
      'remove_persona_image',
      'publish_video_direct',
      'get_token_balance',
      'generate_persona_videos',
      'get_video_status',
      'get_video_task_progress',
      'list_social_accounts',
      'connect_account',
      'list_schedules',
      'list_posts',
      'cancel_schedule',
      'get_slot',
      'update_slot_topic',
      'delete_slot',
      'list_video_generations',
      'get_video_generation',
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
      'apiKeys.toolDescGeneratePersonaVideos',
      'apiKeys.toolDescGetVideoStatus',
      'apiKeys.toolDescGetVideoTaskProgress',
      'apiKeys.toolDescListSocialAccounts',
      'apiKeys.toolDescConnectAccount',
      'apiKeys.toolDescListSchedules',
      'apiKeys.toolDescListPosts',
      'apiKeys.toolDescCancelSchedule',
      'apiKeys.toolDescGetSlot',
      'apiKeys.toolDescUpdateSlotTopic',
      'apiKeys.toolDescDeleteSlot',
      'apiKeys.toolDescListVideoGenerations',
      'apiKeys.toolDescGetVideoGeneration',
      'apiKeys.toolDescListTokenTransactions',
      'apiKeys.toolDescGetPersonaDeletePreview',
      'apiKeys.toolDescDeletePersona',
      'apiKeys.toolDescDisconnectAccount',
    ]) {
      expect(within(grid).getByText(descKey)).toBeInTheDocument();
    }
  });

  it('copies the install prompt mentioning post-engineer to the clipboard', () => {
    render(<McpDocsSection />);

    // The button starts in the un-copied state (kills the useState(true) mutant).
    expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy');
    fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledOnce();
    const prompt = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0][0] as string;
    expect(prompt).toContain('post-engineer');
    expect(prompt).toContain('POST_ENGINEER_API_KEY');
    expect(prompt).toContain('generate_persona_videos');
    expect(prompt).toContain('"command": ["npx", "-y", "post-engineer-mcp@latest"]');
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
    // The nine gap-closing tools must be documented for the agent in the
    // copied prompt, or the prompt silently omits what the server offers.
    for (const tool of [
      'get_slot',
      'update_slot_topic',
      'delete_slot',
      'list_video_generations',
      'get_video_generation',
      'list_token_transactions',
      'get_persona_delete_preview',
      'delete_persona',
      'disconnect_account',
    ]) {
      expect(prompt).toContain(`- ${tool}:`);
    }
    const visiblePrompt = screen.getByTestId('mcp-install-prompt');
    expect(visiblePrompt).toHaveTextContent('post-engineer-mcp');
    expect(visiblePrompt).toHaveTextContent('How to work with me');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('resets the copy button label after the confirmation timeout', () => {
    vi.useFakeTimers();
    try {
      render(<McpDocsSection />);

      fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copied!');

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByTestId('copy-mcp-prompt-btn')).toHaveTextContent('Copy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins the full install prompt in each locale (agent-facing contract)', () => {
    // The install prompt is the agent's source of truth for the MCP server:
    // every line is asserted so prompt copy can only change deliberately.
    for (const [locale, expected] of [
      ['en', EXPECTED_EN_PROMPT],
      ['pt', EXPECTED_PT_PROMPT],
    ] as const) {
      mockLocale = locale;
      const { unmount } = render(<McpDocsSection />);
      fireEvent.click(screen.getByTestId('copy-mcp-prompt-btn'));
      const calls = vi.mocked(window.navigator.clipboard.writeText).mock.calls;
      const prompt = calls[calls.length - 1][0] as string;
      expect(prompt.split('\n'), `${locale} prompt`).toEqual(expected);
      unmount();
    }
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
      // Scoped to the window phrase: a bare '24h' token would false-fail if
      // clock-format copy like "times (HH:MM, 24h)" is ever added to the prompt.
      expect(prompts[locale], `${locale} prompt`).not.toMatch(
        /24h\s*[-–]\s*30d|between 24h and 30|de 24h a 30/,
      );
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
      // The npx install command must pin @latest in both locales: npx
      // reuses its cached copy without checking for updates, so an
      // unpinned command silently serves a stale server version.
      const commandLine = prompts[locale]
        .split('\n')
        .find((line) => line.includes('"command":') && line.includes('npx'));
      expect(commandLine, `${locale} prompt npx command`).toBeDefined();
      expect(commandLine, `${locale} prompt npx command`).toContain(
        'post-engineer-mcp@latest',
      );
      // The nine gap-closing tools are documented in both locales' prompts.
      for (const tool of [
        'get_slot',
        'update_slot_topic',
        'delete_slot',
        'list_video_generations',
        'get_video_generation',
        'list_token_transactions',
        'get_persona_delete_preview',
        'delete_persona',
        'disconnect_account',
      ]) {
        expect(prompts[locale], `${locale} prompt`).toContain(tool);
      }
    }
  });
});
const EXPECTED_EN_PROMPT: string[] = [
  "Add the Post Engineer MCP server to my AI agent configuration.",
  "",
  "I already generated my API key on https://post-engineer.com/api-keys.",
  "",
  "Installation:",
  "1. Configure the MCP server (opencode.json, claude_desktop_config.json, .mcp.json, or Cursor settings) with:",
  "   {",
  "     \"mcpServers\": {",
  "       \"post-engineer\": {",
  "         \"type\": \"local\",",
  "         \"command\": [\"npx\", \"-y\", \"post-engineer-mcp@latest\"],",
  "         \"environment\": {",
  "           \"POST_ENGINEER_API_KEY\": \"<MY_API_KEY>\"",
  "         }",
  "       }",
  "     }",
  "   }",
  "2. Replace <MY_API_KEY> with my real API key. No repository clone or local build is required. The @latest tag forces npx to fetch the newest version instead of reusing a stale cached copy.",
  "",
  "Available tools after connecting:",
  "- list_personas: list my existing personas (id, name, voice, language, niche).",
  "- list_voices: list available persona voices (live catalog, never hardcoded).",
  "- list_faces: list stock avatar faces (id, url, name, gender, age, ethnicity, hair, description in English); pass a face url as avatarUrl when calling create_persona.",
  "- create_persona: create an AI persona (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9, scriptPrompt, paragraphNumber 1-5, niche).",
  "- update_persona: update an existing persona (only provided fields change).",
  "- list_persona_images: list a persona's image library (id, tag, description, is_primary); pass an id as imageId to generate_persona_videos to force a specific image for one video.",
  "- add_persona_image: add an image to a persona's library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.",
  "- update_persona_image: update a library image's tag, description, or primary flag.",
  "- remove_persona_image: remove an image from a persona's library.",
  "- publish_video_direct: publish a ready-made video file directly (no generation, no schedule): local .mp4/.mov path (max 2GB) + account IDs from list_social_accounts; YouTube needs title, description, tags, privacyStatus; Instagram/Bluesky/LinkedIn need caption.",
  "- get_token_balance: get my prepaid token wallet balance.",
  "- generate_persona_videos: generate AND schedule 1-10 persona videos in ONE operation (personaId optional — omit it for a faceless post with no persona, then set options.faceless and options.voiceId, plus scriptPrompt/videoAspect/language/niche as needed; topics is one topic per video; providers plus per-provider account IDs from list_social_accounts; mode 'scheduled' (default) slots each video across startAt ISO datetime + times [\"HH:MM\"] in timezone, mode 'asap' publishes each video the moment its generation finishes with no startAt/times; slots must be 3h-30d ahead; optional overrides: scriptPrompt/scriptPrompts, audioUrl overriding the persona voice, imageId from list_persona_images, webhookUrl). Each video is generated then auto-published at its slot; there is no separate schedule step. Poll each slot's taskId with get_video_task_progress. Costs tokens per video.",
  "- get_video_status: check generation status with a taskId and get the final video URL.",
  "- get_video_task_progress: poll one video task for machine-readable progress ({task_id, state, progress, stage, error}); error is the failure reason when state is -1, null otherwise; use per video (1/6, 2/6, ...) after generate_persona_videos.",
  "- list_social_accounts: list my connected social accounts with the account IDs needed for scheduling.",
  "- connect_account: connect a social account (youtube/instagram/linkedin return an authorization URL for me to open in a browser; bluesky connects directly with handle + app password).",
  "- list_schedules: list my automation schedules.",
  "- list_posts: list my upcoming (scheduled) and past posts across all connected accounts (optional limit, default 20, max 500).",
  "- cancel_schedule: cancel a schedule by its ID.",
  "- get_slot: get one scheduled post's full detail by slot ID (status, topic, scheduled time, progress, schedule, persona).",
  "- update_slot_topic: edit the topic of a scheduled post that has not started generating yet.",
  "- delete_slot: delete one scheduled post slot (only pending/awaiting or failed slots; never the schedule's last slot).",
  "- list_video_generations: list my video generation history, newest first (optional limit, default 50, max 200).",
  "- get_video_generation: get one video generation's detail by generation ID.",
  "- list_token_transactions: list my token ledger — every credit and debit (purchases, generation spends, refunds), newest first (optional limit, default 20, max 100).",
  "- get_persona_delete_preview: preview what deleting a persona would remove (counts + per-video download links). Read-only.",
  "- delete_persona: DESTRUCTIVE — delete a persona with all its schedules, slots, videos, and image library. No token refunds.",
  "- disconnect_account: disconnect a social account by provider and account ID (the IDs from list_social_accounts).",
  "",
  "How to work with me (agent instructions):",
  "1. Start by calling list_personas and showing me what I already have (name, language, niche). If I have none, say so.",
  "2. Ask me what I want before doing anything that costs tokens. Check get_token_balance first and warn me if the balance is low. Use an existing persona or create a new one? If new, call list_voices and show me the real voice options, then ask for: language (e.g. pt-BR, en-US), niche/topic, avatar (photo URL or a stock face from list_faces — every persona has a face), voice choice, video format 9:16 or 16:9, and the script style/prompt.",
  "3. Confirm the persona details with me before calling create_persona. To fix a persona later, use update_persona (never create a duplicate). Never invent a personaId: always use the id returned by list_personas or create_persona.",
  "4. For videos, confirm the script/prompt with me first, then call generate_persona_videos (one topic per video) and poll each slot's taskId with get_video_task_progress until it finishes. Ask me whether the videos should show the persona face or be faceless (options.faceless). Share the final video URL with me.",
  "5. For publishing, call list_social_accounts first to discover my connected accounts and their IDs. Then ask for the platforms, start date, publish times, and timezone. Only schedule between 3h and 30 days in advance. Show my schedules with list_schedules on request, and use cancel_schedule to remove one.",
  "6. When I ask about my posts (what is coming next, what already went out), call list_posts and summarize the upcoming and past posts, including any failure errors.",
];

const EXPECTED_PT_PROMPT: string[] = [
  "Adicione o servidor MCP do Post Engineer na configuração do meu agente de IA.",
  "",
  "Eu já gerei minha API key em https://post-engineer.com/api-keys.",
  "",
  "Instalação:",
  "1. Configure o servidor MCP (opencode.json, claude_desktop_config.json, .mcp.json ou Cursor) com:",
  "   {",
  "     \"mcpServers\": {",
  "       \"post-engineer\": {",
  "         \"type\": \"local\",",
  "         \"command\": [\"npx\", \"-y\", \"post-engineer-mcp@latest\"],",
  "         \"environment\": {",
  "           \"POST_ENGINEER_API_KEY\": \"<MINHA_API_KEY>\"",
  "         }",
  "       }",
  "     }",
  "   }",
  "2. Substitua <MINHA_API_KEY> pela minha API key real. Não é necessário clonar o repositório nem fazer build local. A tag @latest força o npx a baixar a versão mais nova em vez de reutilizar uma cópia antiga em cache.",
  "",
  "Tools disponíveis após conectar:",
  "- list_personas: listar minhas personas existentes (id, nome, voz, idioma, nicho).",
  "- list_voices: listar as vozes disponíveis (catálogo vivo, nunca hardcoded).",
  "- list_faces: listar rostos de avatar padrão (id, url, nome, gênero, idade, etnia, cabelo, descrição em inglês); use a url como avatarUrl ao chamar create_persona.",
  "- create_persona: criar uma persona de IA (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9, scriptPrompt, paragraphNumber 1-5, niche).",
  "- update_persona: atualizar uma persona existente (só os campos enviados mudam).",
  "- list_persona_images: listar a biblioteca de imagens de uma persona (id, tag, description, is_primary); passe um id como imageId no generate_persona_videos para forçar uma imagem específica em um vídeo.",
  "- add_persona_image: adicionar uma imagem à biblioteca de uma persona a partir de um arquivo local (JPG/JPEG, PNG ou WebP, máx 9MB). Tag e descrição opcionais guiam a seleção determinística de imagem por vídeo.",
  "- update_persona_image: atualizar a tag, a descrição ou o flag de principal de uma imagem da biblioteca.",
  "- remove_persona_image: remover uma imagem da biblioteca de uma persona.",
  "- publish_video_direct: publicar um vídeo pronto diretamente (sem geração, sem agendamento): arquivo local .mp4/.mov (máx 2GB) + account IDs do list_social_accounts; YouTube exige title, description, tags e privacyStatus; Instagram/Bluesky/LinkedIn exigem caption.",
  "- get_token_balance: ver o saldo da minha carteira de tokens.",
  "- generate_persona_videos: gerar E agendar de 1 a 10 vídeos de uma persona em UMA operação (personaId opcional — omita para um post faceless sem persona e informe options.faceless e options.voiceId, mais scriptPrompt/videoAspect/language/niche se precisar; topics é um tópico por vídeo; providers mais account IDs por provider do list_social_accounts; startAt datetime ISO, times [\"HH:MM\"], timezone; slots devem estar de 3h a 30 dias à frente). Cada vídeo é gerado e publicado automaticamente no seu slot; não há etapa separada de agendamento. Acompanhe o taskId de cada slot com get_video_task_progress. Custa tokens por vídeo.",
  "- get_video_status: conferir o status da geração com o taskId e pegar a URL do vídeo final.",
  "- get_video_task_progress: acompanhar o progresso legível por máquina de uma tarefa de vídeo ({task_id, state, progress, stage, error}); error é o motivo da falha quando state é -1, null caso contrário; use por vídeo (1/6, 2/6, ...) após generate_persona_videos.",
  "- list_social_accounts: listar minhas contas sociais conectadas com os IDs necessários para agendar.",
  "- connect_account: conectar uma conta social (youtube/instagram/linkedin retornam uma URL de autorização para eu abrir no navegador; bluesky conecta direto com handle + app password).",
  "- list_schedules: listar meus agendamentos.",
  "- list_posts: listar meus posts futuros (agendados) e passados em todas as contas conectadas (limit opcional, padrão 20, máx 500).",
  "- cancel_schedule: cancelar um agendamento pelo ID.",
  "- get_slot: ver o detalhe completo de um post agendado pelo slot ID (status, tópico, horário, progresso, agendamento, persona).",
  "- update_slot_topic: editar o tópico de um post agendado que ainda não começou a gerar.",
  "- delete_slot: deletar um slot de post agendado (só slots pendentes/aguardando ou falhados; nunca o último slot do agendamento).",
  "- list_video_generations: listar meu histórico de gerações de vídeo, do mais recente ao mais antigo (limit opcional, padrão 50, máx 200).",
  "- get_video_generation: ver o detalhe de uma geração de vídeo pelo generation ID.",
  "- list_token_transactions: listar meu extrato de tokens — todos os créditos e débitos (compras, gastos de geração, reembolsos), do mais recente ao mais antigo (limit opcional, padrão 20, máx 100).",
  "- get_persona_delete_preview: ver o que deletar uma persona removeria (contagens + links de download por vídeo). Somente leitura.",
  "- delete_persona: DESTRUTIVO — deleta uma persona com todos os agendamentos, slots, vídeos e biblioteca de imagens. Sem reembolso de tokens.",
  "- disconnect_account: desconectar uma conta social por provider e account ID (os IDs do list_social_accounts).",
  "",
  "Como trabalhar comigo (instruções para o agente):",
  "1. Comece chamando list_personas e me mostrando o que eu já tenho (nome, idioma, nicho). Se eu não tiver nenhuma, diga isso.",
  "2. Pergunte o que eu quero antes de qualquer ação que custe tokens. Consulte get_token_balance primeiro e me avise se o saldo estiver baixo. Usar uma persona existente ou criar uma nova? Se for nova, chame list_voices e me mostre as opções reais de voz, depois pergunte: idioma (ex. pt-BR, en-US), nicho/tema, avatar (foto por URL ou um rosto padrão do list_faces — toda persona tem rosto), escolha de voz, formato 9:16 ou 16:9 e o estilo/prompt do roteiro.",
  "3. Confirme os detalhes da persona comigo antes de chamar create_persona. Para corrigir uma persona depois, use update_persona (nunca crie uma duplicada). Nunca invente um personaId: use sempre o id retornado por list_personas ou create_persona.",
  "4. Para vídeos, confirme o roteiro/prompt comigo primeiro, depois chame generate_persona_videos (um tópico por vídeo) e acompanhe o taskId de cada slot com get_video_task_progress até concluir. Pergunte se os vídeos devem mostrar o rosto da persona ou ser faceless (options.faceless). Compartilhe a URL final do vídeo comigo.",
  "5. Para publicar, chame list_social_accounts primeiro para descobrir minhas contas conectadas e seus IDs. Depois pergunte as plataformas, data de início, horários de publicação e timezone. Agende somente de 3h a 30 dias de antecedência. Mostre meus agendamentos com list_schedules quando eu pedir, e use cancel_schedule para remover um.",
  "6. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame list_posts e resuma os próximos e os passados, incluindo os erros de falha.",
];
