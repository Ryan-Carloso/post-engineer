import { describe, expect, it } from 'vitest';
import { buildInstallPrompt } from '../mcp-install-prompt';

const KEY = 'pe_live_abcdef1234567890abcdef1234567890';

describe('buildInstallPrompt', () => {
  it('pins the full install prompt in each locale (agent-facing contract)', () => {
    expect(buildInstallPrompt('en', null).split('\n')).toEqual(EXPECTED_EN_PROMPT);
    expect(buildInstallPrompt('pt', null).split('\n')).toEqual(EXPECTED_PT_PROMPT);
  });

  const TOOL_ACTIONS: Record<string, string[]> = {
    publish_video: ['from_file', 'create_upload', 'complete_upload', 'publish_upload', 'publish_existing'],
    personas: ['list', 'get', 'create', 'update', 'delete'],
    persona_media: ['get_card', 'render_prompt'],
    accounts: ['list', 'connect', 'disconnect', 'get_persona_publishing', 'set_persona_publishing', 'list_boards'],
    tool_config: ['get', 'save'],
    schedules: ['list', 'cancel', 'get_slot', 'update_slot_title', 'delete_slot'],
    posts: ['list', 'get'],
    insights: ['post_metrics', 'last_day', 'retention_curve', 'share_link_create', 'share_link_list', 'share_link_revoke'],
    experiments: ['results'],
    prompts: ['list', 'get', 'create', 'update', 'delete', 'versions', 'restore'],
  };

  it.each(['en', 'pt'] as const)('documents the 10 tools and every action in the %s prompt', (locale) => {
    const prompt = buildInstallPrompt(locale, null);
    expect(Object.keys(TOOL_ACTIONS)).toHaveLength(10);
    for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
      const bullet = prompt.split('\n').find((line) => line.startsWith(`- ${tool}:`));
      expect(bullet, `${locale} prompt bullet for ${tool}`).toBeDefined();
      for (const action of actions) {
        expect(bullet, `${locale} prompt: ${tool} must name the ${action} action`).toContain(action);
      }
    }
  });

  it('keeps the agent-facing facts the prompt must carry', () => {
    const prompt = buildInstallPrompt('en', null);
    expect(prompt).toContain('post-engineer');
    expect(prompt).toContain('POST_ENGINEER_API_KEY');
    expect(prompt).toContain('"command": ["npx", "-y", "post-engineer-mcp@latest"]');
    expect(prompt).toContain('persona and account fields accept a name or an id');
    expect(prompt).toContain('prompts: list');
    expect(prompt).toContain('does not generate video');
    expect(prompt).toContain('How to work with me');
    expect(prompt).toContain('never create a duplicate');
    expect(prompt).toContain('posts: list (my upcoming and past posts; optional limit, default 20, max 500;');
    expect(prompt).toContain('delete (without confirmToken it only previews what would be removed');
    expect(prompt).not.toContain('Clone');
    expect(prompt).not.toContain('apps/mcp/dist/index.js');
    expect(prompt).not.toContain('POST_ENGINEER_API_URL');
    for (const old of ['generate_video', 'video_tasks', 'cancel_video', 'check_script', 'billing', 'tokens', 'generate_persona_video', 'list_personas', 'get_video_status', 'wait_for_video_tasks', 'list_social_accounts', 'validate_script', 'get_persona_delete_preview', 'cancel_video_task']) {
      expect(prompt, old).not.toContain(old);
    }
  });

  it('documents the hosted remote MCP endpoint beside the npx snippet', () => {
    for (const locale of ['en', 'pt'] as const) {
      const prompt = buildInstallPrompt(locale, null);
      expect(prompt, locale).toContain('https://post-engineer.com/mcp');
      expect(prompt, locale).toContain('publish_video from_file');
      expect(prompt, locale).toContain('publish_video create_upload');
      expect(prompt, locale).toContain('complete_upload');
      expect(prompt, locale).toContain('publish_upload');
    }
  });

  it('points at the prompts hub, never the removed /api-keys page', () => {
    for (const locale of ['en', 'pt'] as const) {
      const prompt = buildInstallPrompt(locale, null);
      expect(prompt, locale).toContain('https://post-engineer.com/recipes.');
      expect(prompt, locale).not.toContain('/api-keys');
    }
  });

  it('fills a created key into the config and drops the replace instruction (EN)', () => {
    const lines = buildInstallPrompt('en', KEY).split('\n');
    const expected = EXPECTED_EN_PROMPT.map((line) =>
      line
        .replace('"<MY_API_KEY>"', `"${KEY}"`)
        .replace(
          'Replace <MY_API_KEY> with my real API key.',
          'The API key above is already my real key.',
        ),
    );
    expect(lines).toEqual(expected);
    expect(lines).toContain(`           "POST_ENGINEER_API_KEY": "${KEY}"`);
    expect(lines.join('\n')).not.toContain('<MY_API_KEY>');
  });

  it('fills a created key into the config and drops the replace instruction (PT)', () => {
    const lines = buildInstallPrompt('pt', KEY).split('\n');
    const expected = EXPECTED_PT_PROMPT.map((line) =>
      line
        .replace('"<MINHA_API_KEY>"', `"${KEY}"`)
        .replace(
          'Substitua <MINHA_API_KEY> pela minha API key real.',
          'A API key acima já é a minha chave real.',
        ),
    );
    expect(lines).toEqual(expected);
    expect(lines).toContain(`           "POST_ENGINEER_API_KEY": "${KEY}"`);
    expect(lines.join('\n')).not.toContain('<MINHA_API_KEY>');
  });

  it('JSON-escapes the key so the config stays valid', () => {
    const prompt = buildInstallPrompt('en', 'a"b');
    expect(prompt).toContain('"POST_ENGINEER_API_KEY": "a\\"b"');
  });

  it('documents the same minimum schedule window in the EN and PT install prompts', () => {
    const prompts: Record<string, string> = {
      en: buildInstallPrompt('en', null),
      pt: buildInstallPrompt('pt', null),
    };
    for (const locale of ['en', 'pt'] as const) {
      expect(prompts[locale], `${locale} prompt`).not.toMatch(
        /24h\s*[-–]\s*30d|between 24h and 30|de 24h a 30/,
      );
      const videoLine = prompts[locale]
        .split('\n')
        .find((line) => line.startsWith('- publish_video:'));
      expect(videoLine, `${locale} prompt`).toBeDefined();
      expect(videoLine, `${locale} prompt`).toContain('3h');
      const step3Line = prompts[locale]
        .split('\n')
        .find((line) => line.startsWith('3. '));
      expect(step3Line, `${locale} prompt step 3`).toBeDefined();
      expect(step3Line, `${locale} prompt step 3`).toContain('3h');
      const commandLine = prompts[locale]
        .split('\n')
        .find((line) => line.includes('"command":') && line.includes('npx'));
      expect(commandLine, `${locale} prompt npx command`).toBeDefined();
      expect(commandLine, `${locale} prompt npx command`).toContain(
        'post-engineer-mcp@latest',
      );
    }
  });
});

const EXPECTED_EN_PROMPT: string[] = [
  'Add the Post Engineer MCP server to my AI agent configuration.',
  '',
  'I already generated my API key on https://post-engineer.com/recipes.',
  '',
  'Installation:',
  '1. Configure the MCP server (opencode.json, claude_desktop_config.json, .mcp.json, or Cursor settings) with:',
  '   {',
  '     "mcpServers": {',
  '       "post-engineer": {',
  '         "type": "local",',
  '         "command": ["npx", "-y", "post-engineer-mcp@latest"],',
  '         "environment": {',
  '           "POST_ENGINEER_API_KEY": "<MY_API_KEY>"',
  '         }',
  '       }',
  '     }',
  '   }',
  '2. Replace <MY_API_KEY> with my real API key. No repository clone or local build is required. The @latest tag forces npx to fetch the newest version instead of reusing a stale cached copy.',
  '',
  'Remote (hosted) option — no local install needed:',
  'If your agent supports remote MCP servers (for example ChatGPT), connect it to https://post-engineer.com/mcp instead of the npx command above. It serves the same 10 tools over Streamable HTTP with OAuth sign-in — sign in to Post Engineer when prompted. The actions that read a file from your own machine (publish_video from_file, and a local imagePath or avatarPath) are not available remotely: upload a video or image with publish_video create_upload (PUT the bytes to its signed URL), then complete_upload, then publish_upload or publish_existing.',
  '',
  'Available tools after connecting (10 tools; every one takes an "action"; persona and account fields accept a name or an id). Post Engineer does not generate video: I make the media with my own tools, and these tools upload, publish, schedule and measure it:',
  '- publish_video: publish media I made: from_file (a local .mp4/.mov, max 2GB, published now), create_upload, complete_upload and publish_upload (a signed upload, video or JPEG/PNG: the bytes never pass through the server; published now), and publish_existing (a completed upload, or a local image, to every network of its accounts in one call, with mode asap or scheduled at publishAt 3h-30d ahead; a scheduled post accepts a promptVersionId for experiments). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption. The 7-day free trial gates publishing: after it ends the call fails with TRIAL_EXPIRED and names the contact link.',
  '- personas: list (id and name), get, create (a name and at least one publishing account; a photo is optional), update (only the given fields change; identityCard sets the identity card, or null removes it) and delete (without confirmToken it only previews what would be removed; send the confirmToken of that preview to delete).',
  '- persona_media: get_card returns the persona\'s identity card (or null); render_prompt renders a deterministic image-edit prompt from the card plus a scene (outfit, pose, setting, lighting, framing) — advice for your image tool, nothing is generated or stored.',
  '- accounts: list (my connected social accounts with the names and ids to publish with), connect (OAuth link for youtube/instagram/linkedin/threads/facebook/pinterest/fanvue; direct connect for bluesky, 3speak, rumble and telegram), disconnect (by name or id), get_persona_publishing and set_persona_publishing (the accounts a persona publishes to by default), list_boards (Pinterest boards).',
  '- tool_config: get (my saved search and stock tool configuration: which search tool and stock sources I have keys for — keys are never shown back in full) and save (replace the whole set, keys included, stored encrypted).',
  '- schedules: list, cancel (a whole schedule), get_slot, update_slot_title and delete_slot (one scheduled post).',
  '- posts: list (my upcoming and past posts; optional limit, default 20, max 500; each slot carries postUrl, the link to its detail page — send it in chat) and get (one post by slot id).',
  '- insights: post_metrics (per-video performance for window 24h, 7d or 28d, optional persona, provider and account filters), last_day (views and engagement each video gained in the last 24 hours, optional persona, provider and account filters), retention_curve (the audience retention curve of one of my own YouTube videos), and share_link_create, share_link_list and share_link_revoke (a public read-only link, no login, to my metrics summary and this week\'s posts; create can limit it to one persona and set an expiry; the url is returned once).',
  '- experiments: results (compare my prompts inside each publishing account: every post scheduled with a promptVersionId records that prompt version; window 24h, 7d or 28d; a label says whether a difference is clear, indicative or not there yet).',
  '- prompts: list (the prompts this server can run: mine and the public ones; call it first when I ask for copy about a topic) and get (one prompt by slug, as ready-to-run instructions; unverified community prompts carry a notice, verified ones do not). It also writes my own prompts, private by default: create, update (title, description, text, or visibility: public lets anyone read it, private keeps it to me), delete and restore (make an old version the current text, as a new version); versions only reads the saved texts of my prompt, newest first (pass version to read one in full). Only I can change my prompts and read their history.',
  '- Prompts: copy one from https://post-engineer.com/recipes or run it as a slash command on this server.',
  '',
  'How to work with me (agent instructions):',
  '1. Start by calling accounts (action: list) and personas (action: list) and showing me the accounts and personas I already have. If I have none, say so.',
  '2. Ask me what I want to publish and where before doing anything. To group accounts, create a persona with personas (action: create) after confirming its name and accounts with me; to fix one later, use personas (action: update) (never create a duplicate).',
  '3. For a post, upload my file with publish_video (from_file for a local video, or create_upload → PUT → complete_upload), then publish it with publish_upload or publish_existing. Ask me for the networks, the caption or title, and whether to publish now (mode asap) or at a time (mode scheduled, 3h to 30 days ahead, with my timezone). Share the post URL with me.',
  '4. Show my schedules with schedules (action: list) on request, and use schedules (action: cancel) to remove one.',
  '5. When I ask about my posts (what is coming next, what already went out), call posts (action: list) and summarize the upcoming and past posts, including any failure errors. For performance, use insights (action: post_metrics).',
];

const EXPECTED_PT_PROMPT: string[] = [
  'Adicione o servidor MCP do Post Engineer na configuração do meu agente de IA.',
  '',
  'Eu já gerei minha API key em https://post-engineer.com/recipes.',
  '',
  'Instalação:',
  '1. Configure o servidor MCP (opencode.json, claude_desktop_config.json, .mcp.json ou Cursor) com:',
  '   {',
  '     "mcpServers": {',
  '       "post-engineer": {',
  '         "type": "local",',
  '         "command": ["npx", "-y", "post-engineer-mcp@latest"],',
  '         "environment": {',
  '           "POST_ENGINEER_API_KEY": "<MINHA_API_KEY>"',
  '         }',
  '       }',
  '     }',
  '   }',
  '2. Substitua <MINHA_API_KEY> pela minha API key real. Não é necessário clonar o repositório nem fazer build local. A tag @latest força o npx a baixar a versão mais nova em vez de reutilizar uma cópia antiga em cache.',
  '',
  'Opção remota (hospedada) — sem instalação local:',
  'Se o seu agente suporta servidores MCP remotos (por exemplo, ChatGPT), conecte-o a https://post-engineer.com/mcp em vez do comando npx acima. Ele serve as mesmas 10 tools por Streamable HTTP com login OAuth — faça login no Post Engineer quando solicitado. As actions que leem um arquivo da sua máquina (publish_video from_file, e um imagePath ou avatarPath local) não estão disponíveis remotamente: envie um vídeo ou imagem com publish_video create_upload (PUT dos bytes na signed URL), depois complete_upload, depois publish_upload ou publish_existing.',
  '',
  'Tools disponíveis após conectar (10 tools; todas recebem um "action"; os campos de persona e de conta aceitam um nome ou um id). O Post Engineer não gera vídeo: eu faço a mídia com minhas próprias ferramentas, e estas tools enviam, publicam, agendam e medem:',
  '- publish_video: publicar a mídia que eu fiz: from_file (um .mp4/.mov local, máx 2GB, publicado na hora), create_upload, complete_upload e publish_upload (um upload assinado, vídeo ou JPEG/PNG: os bytes nunca passam pelo servidor; publicado na hora), e publish_existing (um upload concluído, ou uma imagem local, para todas as redes das contas em uma chamada, com mode asap ou scheduled em publishAt de 3h a 30d à frente; um post agendado aceita um promptVersionId para experimentos). YouTube exige title, description, tags e privacyStatus; Rumble e Fanvue title e description; as demais redes uma caption. O teste grátis de 7 dias controla a publicação: depois que ele termina a chamada falha com TRIAL_EXPIRED e mostra o link de contato.',
  '- personas: list (id e nome), get, create (um nome e ao menos uma conta de publicação; a foto é opcional), update (só os campos enviados mudam; identityCard define o cartão de identidade, ou null remove-o) e delete (sem confirmToken só mostra o que seria removido; envie o confirmToken dessa prévia para apagar).',
  '- persona_media: get_card devolve o cartão de identidade da persona (ou null); render_prompt gera um prompt determinístico de edição de imagem a partir do cartão mais uma cena (roupa, pose, cenário, iluminação, enquadramento) — orientação para a sua ferramenta de imagem, nada é gerado ou guardado.',
  '- accounts: list (minhas contas sociais conectadas com os nomes e ids para publicar), connect (link OAuth para youtube/instagram/linkedin/threads/facebook/pinterest/fanvue; conexão direta para bluesky, 3speak, rumble e telegram), disconnect (por nome ou id), get_persona_publishing e set_persona_publishing (as contas em que uma persona publica por padrão), list_boards (boards do Pinterest).',
  '- tool_config: get (minha configuração salva de pesquisa e stock: qual ferramenta de busca e fontes de stock tenho chaves — as chaves nunca são exibidas por inteiro) e save (substitui tudo, chaves incluídas, guardadas com criptografia).',
  '- schedules: list, cancel (um agendamento inteiro), get_slot, update_slot_title e delete_slot (um post agendado).',
  '- posts: list (meus posts futuros e passados; limit opcional, padrão 20, máx 500; cada slot traz postUrl, o link da página de detalhe — envie no chat) e get (um post por id de slot).',
  '- insights: post_metrics (desempenho por vídeo para a janela 24h, 7d ou 28d, filtros opcionais persona, provider e account), last_day (views e engajamento que cada vídeo ganhou nas últimas 24h, filtros opcionais persona, provider e account), retention_curve (a curva de retenção da audiência de um dos meus vídeos do YouTube) e share_link_create, share_link_list e share_link_revoke (um link público somente leitura, sem login, para o resumo das minhas métricas e os posts da semana; create pode limitar a uma persona e definir validade; a url é devolvida uma única vez).',
  '- experiments: results (compara meus prompts dentro de cada conta de publicação: cada post agendado com um promptVersionId guarda essa versão do prompt; janela 24h, 7d ou 28d; um rótulo diz se a diferença é clara, um indício ou ainda não existe).',
  '- prompts: list (os prompts que este servidor executa: os meus e os públicos; chame primeiro quando eu pedir um texto sobre um assunto) e get (um prompt pelo slug, como instruções prontas para executar; prompts da comunidade não verificados vêm com um aviso, os verificados não). Também escreve meus próprios prompts, privados por padrão: create, update (título, descrição, texto ou visibility: public deixa qualquer pessoa ler, private mantém só comigo), delete e restore (volta um texto antigo como texto atual, em uma nova versão); versions só lê os textos salvos do meu prompt, do mais recente ao mais antigo (passe version para ler um completo). Só eu posso alterar meus prompts e ler o histórico deles.',
  '- Prompts: copie um em https://post-engineer.com/recipes ou rode como comando de barra neste servidor.',
  '',
  'Como trabalhar comigo (instruções para o agente):',
  '1. Comece chamando accounts (action: list) e personas (action: list) e me mostrando as contas e personas que eu já tenho. Se eu não tiver nenhuma, diga isso.',
  '2. Pergunte o que eu quero publicar e onde antes de qualquer ação. Para agrupar contas, crie uma persona com personas (action: create) depois de confirmar comigo o nome e as contas; para corrigir uma depois, use personas (action: update) (nunca crie uma duplicada).',
  '3. Para um post, envie meu arquivo com publish_video (from_file para um vídeo local, ou create_upload → PUT → complete_upload) e publique com publish_upload ou publish_existing. Pergunte as redes, a legenda ou título, e se é para publicar agora (mode asap) ou num horário (mode scheduled, de 3h a 30 dias à frente, com meu timezone). Compartilhe a URL do post comigo.',
  '4. Mostre meus agendamentos com schedules (action: list) quando eu pedir, e use schedules (action: cancel) para remover um.',
  '5. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame posts (action: list) e resuma os próximos e os passados, incluindo os erros de falha. Para desempenho, use insights (action: post_metrics).',
];
