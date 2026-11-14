import { describe, expect, it } from 'vitest';
import { buildInstallPrompt } from '../mcp-install-prompt';

const KEY = 'pe_live_abcdef1234567890abcdef1234567890';

describe('buildInstallPrompt', () => {
  it('pins the full install prompt in each locale (agent-facing contract)', () => {
    // The install prompt is the agent's source of truth for the MCP server:
    // every line is asserted so prompt copy can only change deliberately.
    expect(buildInstallPrompt('en', null).split('\n')).toEqual(EXPECTED_EN_PROMPT);
    expect(buildInstallPrompt('pt', null).split('\n')).toEqual(EXPECTED_PT_PROMPT);
  });

  // Issue #566: 16 intent tools. The prompt documents every tool with one
  // bullet and names each of its actions, in both locales, or the agent
  // silently never learns what the server offers.
  const TOOL_ACTIONS: Record<string, string[]> = {
    generate_video: [],
    video_tasks: ['status', 'list_generations', 'get_generation'],
    cancel_video: [],
    personas: ['list', 'get', 'create', 'update', 'delete'],
    persona_media: ['list_faces', 'list_images', 'add_image', 'update_image', 'remove_image'],
    voices: ['list', 'preview', 'list_clones', 'create_clone', 'get_clone', 'preview_clone', 'delete_clone'],
    accounts: ['list', 'connect', 'disconnect', 'get_persona_publishing', 'set_persona_publishing', 'list_boards'],
    schedules: ['list', 'cancel', 'get_slot', 'update_slot_title', 'delete_slot'],
    posts: ['list', 'get'],
    insights: ['post_metrics', 'retention_curve'],
    experiments: ['create', 'add_pair', 'list', 'results'],
    media: ['check', 'upload'],
    billing: ['balance', 'transactions'],
    prompts: ['list', 'get'],
    check_script: ['validate', 'score'],
    publish_video: ['from_file', 'create_upload', 'complete_upload', 'publish_upload'],
  };

  it.each(['en', 'pt'] as const)('documents the 16 tools and every action in the %s prompt', (locale) => {
    const prompt = buildInstallPrompt(locale, null);
    expect(Object.keys(TOOL_ACTIONS)).toHaveLength(16);
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
    // Recipe self-serve must be discoverable in the copied prompt: the
    // agent learns prompts (action: list) before any improvised script.
    expect(prompt).toContain('prompts: list');
    expect(prompt).toContain('segments');
    expect(prompt).toContain('How to work with me');
    expect(prompt).toContain('Never invent a persona');
    expect(prompt).toContain('posts: list (my upcoming and past posts; optional limit, default 20, max 500;');
    expect(prompt).toContain('delete (without confirmToken it only previews what would be removed');
    expect(prompt).toContain('A batch needs a batchKey');
    expect(prompt).not.toContain('Clone');
    expect(prompt).not.toContain('apps/mcp/dist/index.js');
    expect(prompt).not.toContain('POST_ENGINEER_API_URL');
    // None of the 56 removed tool names may be left in the copy agents paste.
    for (const old of ['generate_persona_video', 'list_personas', 'get_video_status', 'wait_for_video_tasks', 'list_social_accounts', 'validate_script', 'get_persona_delete_preview', 'cancel_video_task']) {
      expect(prompt, old).not.toContain(old);
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
    // The generate_video doc line is the agent's source of truth
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
        .find((line) => line.includes('- generate_video:'));
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
  'Available tools after connecting (16 tools; every one except generate_video and cancel_video takes an "action"; persona and account fields accept a name or an id):',
  '- generate_video: generate AND schedule one persona video, or a batch of 2-12 (every 6 videos with the persona face, the cheapest is free), from complete scripts. Each entry of videos has persona (a name or id; omit it for a faceless post with no persona, then set options.videoType to \'faceless\' and options.voiceId), accounts (account names or ids from accounts (action: list); omit them to publish to the persona\'s bound accounts), title, description and segments (first hook, then content takes in order; 60-200 words total, content at least 30, hook 15-40 words ending with terminal punctuation — no LLM expands it), plus mode \'scheduled\' (default: startAt ISO datetime + times ["HH:MM"] in timezone; slot must be 3h-30d ahead) or \'asap\' (publishes the moment generation finishes, no startAt/times). A batch needs a batchKey; one video may take an idempotencyKey. Persona and accounts are resolved by name before anything is created, and the result says what was resolved. The video is generated then auto-published at its slot; there is no separate schedule step. Costs tokens.',
  '- video_tasks: follow videos. status takes up to 12 taskIds (waitSeconds 0 = a snapshot of state, progress, stage, error and post link; more = block until they finish); list_generations and get_generation show the generation history.',
  '- cancel_video: cancel a video that is still generating.',
  '- personas: list (id, name, voice, language, niche), get, create (a face is required: avatarUrl, or avatarPath for a local photo; at least one publishing account), update (only the given fields change) and delete (without confirmToken it only previews what would be removed; send the confirmToken of that preview to delete).',
  '- persona_media: list_faces (stock avatar faces; pass a face url as avatarUrl to personas create), list_images, add_image (a local file, JPG/JPEG, PNG or WebP), update_image and remove_image for a persona\'s image library; pass an image id as imageId to generate_video to force that image.',
  '- voices: list (live catalog of house voices with descriptions; filter with gender, origin, search), preview (a short MP3 of a house voice), and clones: list_clones, create_clone (from an audio URL or a local audio file; needs explicit consent), get_clone (poll until ready), preview_clone, delete_clone.',
  '- accounts: list (my connected social accounts with the names and ids to publish with), connect (OAuth link for youtube/instagram/linkedin/threads/facebook/fanvue; direct connect for bluesky, 3speak and rumble), disconnect (by name or id), get_persona_publishing and set_persona_publishing (the accounts a persona publishes to by default), list_boards (Pinterest boards).',
  '- schedules: list, cancel (a whole schedule), get_slot, update_slot_title and delete_slot (one scheduled post).',
  '- posts: list (my upcoming and past posts; optional limit, default 20, max 500; each slot carries postUrl, the link to its detail page — send it in chat) and get (one post by slot id or generation id).',
  '- insights: post_metrics (per-video performance for window 24h, 7d or 28d, optional persona, provider, account and angle filters) and retention_curve (the audience retention curve of one of my own YouTube videos).',
  '- experiments: paired A/B hook experiments: create, add_pair (both videos of a pair), list and results.',
  '- media: check (mechanically check one public image URL for a segment; returns exactly one code: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect or media_expired) and upload (a local image becomes a mediaId; temporary, 1 hour).',
  '- billing: balance (my prepaid token balance) and transactions (the token ledger, newest first).',
  '- prompts: list (the recipe prompts this server can run — news, place spotlight, subject spotlight, GitHub PRs, full setup; call it first when I ask for a video about a topic) and get (one recipe by slug, as ready-to-run validated instructions).',
  '- check_script: validate (a segments script mechanically, without spending tokens) and score (a draft against my own measured posts, 0-100, every point explained).',
  '- publish_video: publish a ready-made video directly, no generation and no schedule: from_file (a local .mp4/.mov, max 2GB) or create_upload, complete_upload and publish_upload (a signed upload: the bytes never pass through the server). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption.',
  '- Recipes: daily news becomes a video — copy the prompt from https://post-engineer.com/recipes/daily-news or run /daily-news on this server; docs/recipes/daily-news.md has the worked example.',
  '- Recipes: place spotlight becomes a video — copy the prompt from https://post-engineer.com/recipes/place-spotlight or run /place-spotlight on this server; docs/recipes/place-spotlight.md has the worked example.',
  '- Recipes: subject spotlight becomes a video — copy the prompt from https://post-engineer.com/recipes/subject-spotlight or run /subject-spotlight on this server; docs/recipes/subject-spotlight.md has the worked example.',
  '',
  'How to work with me (agent instructions):',
  '1. Start by calling personas (action: list) and showing me what I already have (name, language, niche). If I have none, say so.',
  '2. Ask me what I want before doing anything that costs tokens. Check billing (action: balance) first and warn me if the balance is low. Use an existing persona or create a new one? If new, call voices (action: list) and show me the real voice options, then ask for: language (e.g. pt-BR, en-US), niche, video subject area, avatar (photo URL or a stock face from persona_media (action: list_faces) — every persona has a face), voice choice, video format 9:16 or 16:9, and the script style/prompt.',
  '3. Confirm the persona details with me before calling personas (action: create). To fix a persona later, use personas (action: update) (never create a duplicate). Never invent a persona: use a name or id from personas (action: list), or the one personas (action: create) returned.',
  '4. For videos, confirm the script/prompt with me first, then call generate_video with the full segments script and title, and call video_tasks (action: status) with the taskId until it finishes. Ask me whether the videos should show the persona face or be faceless (options.videoType: \'faceless\'). Share the post URL with me.',
  '5. For publishing, call accounts (action: list) first to discover my connected accounts and their IDs. Then ask for the platforms, start date, publish times, and timezone. Only schedule between 3h and 30 days in advance. Show my schedules with schedules (action: list) on request, and use schedules (action: cancel) to remove one.',
  '6. When I ask about my posts (what is coming next, what already went out), call posts (action: list) and summarize the upcoming and past posts, including any failure errors.',
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
  'Tools disponíveis após conectar (16 tools; todas, exceto generate_video e cancel_video, recebem um "action"; os campos de persona e de conta aceitam um nome ou um id):',
  '- generate_video: gerar E agendar um vídeo de persona, ou um lote de 2-12 (a cada 6 vídeos com o rosto da persona, o mais barato sai de graça), a partir de roteiros completos. Cada item de videos tem persona (um nome ou id; omita para um post sem persona, faceless, e então defina options.videoType como \'faceless\' e options.voiceId), accounts (nomes ou ids de contas do accounts (action: list); omita para publicar nas contas vinculadas à persona), title, description e segments (primeiro o hook, depois takes de conteúdo em ordem; 60-200 palavras no total, conteúdo no mínimo 30, hook de 15-40 palavras terminando com pontuação final — nenhum LLM expande o roteiro), mais mode \'scheduled\' (padrão: startAt em ISO + times ["HH:MM"] no timezone; o slot deve estar 3h-30d à frente) ou \'asap\' (publica assim que a geração termina, sem startAt/times). Um lote precisa de um batchKey; um vídeo pode receber um idempotencyKey. Persona e contas são resolvidas por nome antes de qualquer criação, e o resultado diz o que foi resolvido. O vídeo é gerado e publicado automaticamente no slot; não há passo de agendamento separado. Gasta tokens.',
  '- video_tasks: acompanhar vídeos. status recebe até 12 taskIds (waitSeconds 0 = foto do estado, progresso, etapa, erro e link do post; maior = espera até terminarem); list_generations e get_generation mostram o histórico de gerações.',
  '- cancel_video: cancelar um vídeo que ainda está sendo gerado.',
  '- personas: list (id, nome, voz, idioma, nicho), get, create (um rosto é obrigatório: avatarUrl, ou avatarPath para uma foto local; ao menos uma conta de publicação), update (só os campos enviados mudam) e delete (sem confirmToken só mostra o que seria removido; envie o confirmToken dessa prévia para apagar).',
  '- persona_media: list_faces (rostos de avatar padrão; use a url do rosto como avatarUrl no personas create), list_images, add_image (arquivo local JPG/JPEG, PNG ou WebP), update_image e remove_image da biblioteca de imagens de uma persona; passe o id de uma imagem como imageId no generate_video para forçar essa imagem.',
  '- voices: list (catálogo vivo de vozes da casa com descrições; filtre com gender, origin, search), preview (um MP3 curto de uma voz da casa) e clones: list_clones, create_clone (a partir de uma URL de áudio ou de um arquivo de áudio local; exige consentimento explícito), get_clone (consulte até ficar ready), preview_clone, delete_clone.',
  '- accounts: list (minhas contas sociais conectadas com os nomes e ids para publicar), connect (link OAuth para youtube/instagram/linkedin/threads/facebook/fanvue; conexão direta para bluesky, 3speak e rumble), disconnect (por nome ou id), get_persona_publishing e set_persona_publishing (as contas em que uma persona publica por padrão), list_boards (boards do Pinterest).',
  '- schedules: list, cancel (um agendamento inteiro), get_slot, update_slot_title e delete_slot (um post agendado).',
  '- posts: list (meus posts futuros e passados; limit opcional, padrão 20, máx 500; cada slot traz postUrl, o link da página de detalhe — envie no chat) e get (um post por id de slot ou de geração).',
  '- insights: post_metrics (desempenho por vídeo para a janela 24h, 7d ou 28d, filtros opcionais persona, provider, account e angle) e retention_curve (a curva de retenção da audiência de um dos meus vídeos do YouTube).',
  '- experiments: experimentos A/B pareados de hook: create, add_pair (os dois vídeos de um par), list e results.',
  '- media: check (verifica mecanicamente uma URL pública de imagem para um segmento; devolve exatamente um código: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect ou media_expired) e upload (uma imagem local vira um mediaId; temporário, 1 hora).',
  '- billing: balance (meu saldo de tokens pré-pagos) e transactions (o extrato de tokens, mais recentes primeiro).',
  '- prompts: list (as receitas de prompt que este servidor executa — notícias, destaque de lugar, destaque de assunto, GitHub PRs, setup completo; chame primeiro quando eu pedir um vídeo sobre um assunto) e get (uma receita pelo slug, como instruções validadas prontas para executar).',
  '- check_script: validate (um roteiro em segments mecanicamente, sem gastar tokens) e score (um rascunho contra meus posts medidos, 0-100, cada ponto explicado).',
  '- publish_video: publicar um vídeo pronto diretamente, sem geração e sem agendamento: from_file (um .mp4/.mov local, máx 2GB) ou create_upload, complete_upload e publish_upload (um upload assinado: os bytes nunca passam pelo servidor). YouTube exige title, description, tags e privacyStatus; Rumble e Fanvue title e description; as demais redes uma caption.',
  '- Receitas: notícias do dia viram vídeo — copie o prompt em https://post-engineer.com/recipes/daily-news ou rode /daily-news neste servidor; docs/recipes/daily-news.md tem o exemplo.',
  '- Receitas: destaque de lugar vira vídeo — copie o prompt em https://post-engineer.com/recipes/place-spotlight ou rode /place-spotlight neste servidor; docs/recipes/place-spotlight.md tem o exemplo.',
  '- Receitas: assunto em destaque vira vídeo — copie o prompt em https://post-engineer.com/recipes/subject-spotlight ou rode /subject-spotlight neste servidor; docs/recipes/subject-spotlight.md tem o exemplo.',
  '',
  'Como trabalhar comigo (instruções para o agente):',
  '1. Comece chamando personas (action: list) e me mostrando o que eu já tenho (nome, idioma, nicho). Se eu não tiver nenhuma, diga isso.',
  '2. Pergunte o que eu quero antes de qualquer ação que custe tokens. Consulte billing (action: balance) primeiro e me avise se o saldo estiver baixo. Usar uma persona existente ou criar uma nova? Se for nova, chame voices (action: list) e me mostre as opções reais de voz, depois pergunte: idioma (ex. pt-BR, en-US), nicho/tema, avatar (foto por URL ou um rosto padrão do persona_media (action: list_faces) — toda persona tem rosto), escolha de voz, formato 9:16 ou 16:9 e o estilo/prompt do roteiro.',
  '3. Confirme os detalhes da persona comigo antes de chamar personas (action: create). Para corrigir uma persona depois, use personas (action: update) (nunca crie uma duplicada). Nunca invente uma persona: use um nome ou id de personas (action: list), ou o que personas (action: create) devolveu.',
  '4. Para vídeos, confirme o roteiro/prompt comigo primeiro, depois chame generate_video com o roteiro completo em segments e o title, e chame video_tasks (action: status) com o taskId do slot até concluir. Pergunte se os vídeos devem mostrar o rosto da persona ou ser faceless (options.videoType: \'faceless\'). Compartilhe a URL final do vídeo comigo.',
  '5. Para publicar, chame accounts (action: list) primeiro para descobrir minhas contas conectadas e seus IDs. Depois pergunte as plataformas, data de início, horários de publicação e timezone. Agende somente de 3h a 30 dias de antecedência. Mostre meus agendamentos com schedules (action: list) quando eu pedir, e use schedules (action: cancel) para remover um.',
  '6. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame posts (action: list) e resuma os próximos e os passados, incluindo os erros de falha.',
];
