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

  it('documents every MCP tool the agent needs', () => {
    const prompt = buildInstallPrompt('en', null);
    expect(prompt).toContain('post-engineer');
    expect(prompt).toContain('POST_ENGINEER_API_KEY');
    expect(prompt).toContain('generate_persona_video');
    expect(prompt).toContain('"command": ["npx", "-y", "post-engineer-mcp@latest"]');
    expect(prompt).toContain('list_personas');
    expect(prompt).toContain('list_voices');
    expect(prompt).toContain('list_faces');
    expect(prompt).toContain('list_social_accounts');
    expect(prompt).toContain('get_token_balance');
    expect(prompt).toContain('cancel_schedule');
    // Recipe self-serve must be discoverable in the copied prompt: the
    // agent learns list_prompts before any improvised script.
    expect(prompt).toContain('list_prompts');
    expect(prompt).toContain('get_prompt');
    // Single-video generation, per-video progress, image library, and account
    // connect must be visible to the agent in the copied prompt.
    expect(prompt).toContain('generate_persona_video');
    expect(prompt).toContain('get_video_task_progress');
    expect(prompt).toContain('list_persona_images');
    expect(prompt).toContain('add_persona_image');
    expect(prompt).toContain('update_persona_image');
    expect(prompt).toContain('remove_persona_image');
    expect(prompt).toContain('connect_account');
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
    // generate_persona_video documents the segments script and title.
    expect(prompt).toContain('generate_persona_video');
    expect(prompt).toContain('segments');
    expect(prompt).toContain('How to work with me');
    expect(prompt).toContain('Never invent a personaId');
    expect(prompt).not.toContain('Clone');
    expect(prompt).not.toContain('apps/mcp/dist/index.js');
    expect(prompt).not.toContain('POST_ENGINEER_API_URL');
    // The prompt must document these tools for the agent, or it silently
    // omits what the server offers.
    for (const tool of [
      'get_slot',
      'update_slot_title',
      'delete_slot',
      'list_video_generations',
      'get_video_generation',
      'get_post',
      'get_post_metrics',
      'get_youtube_retention_curve',
      'cancel_video_task',
      'list_token_transactions',
      'get_persona_delete_preview',
      'delete_persona',
      'disconnect_account',
    ]) {
      expect(prompt).toContain(`- ${tool}:`);
    }
  });

  it('documents the hosted remote MCP endpoint beside the npx snippet', () => {
    // Step 5 of issue #561: a hosted agent (ChatGPT) connects by URL, so
    // the prompt must name the remote endpoint and the local-only tools
    // it drops, with the signed-upload tools that replace them.
    for (const locale of ['en', 'pt'] as const) {
      const prompt = buildInstallPrompt(locale, null);
      expect(prompt, locale).toContain('https://post-engineer.com/mcp');
      expect(prompt, locale).toContain('upload_media');
      expect(prompt, locale).toContain('add_persona_image');
      expect(prompt, locale).toContain('publish_video_direct');
      expect(prompt, locale).toContain('create_video_upload');
      expect(prompt, locale).toContain('complete_video_upload');
      expect(prompt, locale).toContain('publish_uploaded_video');
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
    // The generate_persona_video doc line is the agent's source of truth
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
        .find((line) => line.includes('- generate_persona_video:'));
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
        'update_slot_title',
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
  "I already generated my API key on https://post-engineer.com/recipes.",
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
  "Remote (hosted) option — no local install needed:",
  "If your agent supports remote MCP servers (for example ChatGPT), connect it to https://post-engineer.com/mcp instead of the npx command above. It serves the same tools over Streamable HTTP with OAuth sign-in — sign in to Post Engineer when prompted. Tools that read a file from your own machine (upload_media, add_persona_image, publish_video_direct) are not available remotely: upload a video with create_video_upload (PUT the bytes to its signed URL), then complete_video_upload and publish_uploaded_video.",
  "",
  "Available tools after connecting:",
  "- list_personas: list my existing personas (id, name, voice, language, niche).",
  "- list_voices: list available persona voices (live catalog, never hardcoded).",
  "- list_faces: list stock avatar faces (id, url, name, gender, age, ethnicity, hair, description in English); pass a face url as avatarUrl when calling create_persona.",
  "- create_persona: create an AI persona (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9|1:1, scriptPrompt, paragraphNumber 1-5, niche).",
  "- update_persona: update an existing persona (only provided fields change).",
  "- list_persona_images: list a persona's image library (id, tag, description, is_primary); pass an id as imageId to generate_persona_video to force a specific image for the video.",
  "- add_persona_image: add an image to a persona's library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.",
  "- update_persona_image: update a library image's tag, description, or primary flag.",
  "- remove_persona_image: remove an image from a persona's library.",
  "- publish_video_direct: publish a ready-made video file directly (no generation, no schedule): local .mp4/.mov path (max 2GB) + account IDs from list_social_accounts; YouTube needs title, description, tags, privacyStatus; Instagram/Bluesky/LinkedIn need caption.",
  "- get_token_balance: get my prepaid token wallet balance.",
  "- list_prompts: list the recipe prompts this server can run (slug, title, description per recipe — news, place spotlight, subject spotlight, GitHub PRs, full setup). Call this first when I ask for a video about a topic instead of a ready script.",
  "- get_prompt: get one recipe prompt by its slug (from list_prompts) as ready-to-run validated instructions; unknown slugs return an error naming the valid slugs.",
  "- generate_persona_video: generate AND schedule ONE persona video from a complete script (segments: first hook, then body, last CTA; 60-200 words total, body at least 30, CTA 5-20, hook 15-40 words ending with terminal punctuation — no LLM expands it; title is the slot label; personaId optional — omit it for a faceless post with no persona, then set options.videoType to 'faceless' and options.voiceId; providers plus per-provider account IDs from list_social_accounts; mode 'scheduled' (default) slots the video across startAt ISO datetime + times [\"HH:MM\"] in timezone, mode 'asap' publishes it the moment its generation finishes with no startAt/times; slot must be 3h-30d ahead). The video is generated then auto-published at its slot; there is no separate schedule step. Wait for the slot's taskId with wait_for_video_tasks. Costs tokens.",
  "- validate_script: validate a segments script mechanically, without spending tokens (segments: first hook, then body, last CTA; 60-200 words total, body at least 30, CTA 5-20, hook 15-40 words ending with terminal punctuation). Returns the word counts and the hook window (8-12 seconds spoken). Measured hook duration is pending a hook-only TTS endpoint and is reported as pending, never invented.",
  "- score_draft: score a draft mechanically against your own measured posts, without spending tokens. Returns a 0-100 score where every point is explained, the baseline it was scored against, and the publish check for the requested network (linkedin, youtube, instagram, bluesky). A failing publish check means: fix the draft before scheduling it for that network. Pass kind 'script' for a video script: hashtags are not scored and publishCheck is null.",
  "- upload_media: upload a local image for a video segment and get a mediaId for the segment media field (JPG, PNG, or WebP, max 8MB — the engine photo limit; temporary asset, 1 hour TTL, so upload shortly before generating).",
  "- check_media: mechanically check one public image URL for a segment, without an LLM and without judging relevance (returns exactly one code: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect, or media_expired — with videoAspect 9:16, 16:9 or 1:1 given, an image that cannot fill that frame returns wrong_aspect with its probed width and height).",
  "- Recipes: daily news becomes a video — copy the prompt from https://post-engineer.com/recipes/daily-news or run /daily-news on this server; docs/recipes/daily-news.md has the worked example.",
  "- Recipes: place spotlight becomes a video — copy the prompt from https://post-engineer.com/recipes/place-spotlight or run /place-spotlight on this server; docs/recipes/place-spotlight.md has the worked example.",
  "- Recipes: subject spotlight becomes a video — copy the prompt from https://post-engineer.com/recipes/subject-spotlight or run /subject-spotlight on this server; docs/recipes/subject-spotlight.md has the worked example.",
  "- get_video_status: check generation status with a taskId and get the final video URL.",
  "- get_video_task_progress: poll one video task for machine-readable progress ({task_id, state, progress, stage, error}); error is the failure reason when state is -1, null otherwise; use for the video after generate_persona_video. When the task belongs to a scheduled post, the result carries postUrl, the link to the post's detail page — send it in chat.",
  "- wait_for_video_tasks: wait for one or more video tasks to reach a terminal state (blocks until every taskId completes or fails, or the timeout elapses); use after generate_persona_video or generate_persona_video_batch instead of polling get_video_task_progress. Completed results carry postUrl, the link to the post's detail page — send it in chat.",
  "- list_social_accounts: list my connected social accounts with the account IDs needed for scheduling.",
  "- connect_account: connect a social account (youtube/instagram/linkedin return an authorization URL for me to open in a browser where I am signed in to Post Engineer; bluesky connects directly with handle + app password).",
  "- list_schedules: list my automation schedules.",
  "- list_posts: list my upcoming (scheduled) and past posts across all connected accounts (optional limit, default 20, max 500). Each slot carries postUrl, the link to its detail page — send it in chat.",
  "- cancel_schedule: cancel a schedule by its ID.",
  "- get_slot: get one scheduled post's full detail by slot ID (status, title, scheduled time, progress, schedule, persona).",
  "- update_slot_title: edit the title of a pending or ready scheduled post.",
  "- delete_slot: delete one scheduled post slot (only pending/awaiting, ready, or failed slots; never the schedule's last slot).",
  "- list_video_generations: list my video generation history, newest first (optional limit, default 50, max 200).",
  "- get_video_generation: get one video generation's detail by generation ID.",
  "- cancel_video_task: cancel/remove one of my video tasks on the engine by taskId; only my own task, no token refund.",
  "- get_post: get one post's full detail by id — slot id or generation id, the server resolves which (kind \"slot\" or \"generation\"), with live generation progress. Slot posts carry postUrl, the link to the post's detail page — send it in chat.",
  "- get_post_metrics: per-video performance snapshots (views, likes, comments, saves; YouTube rows add engaged views and stayed-to-watch) for window 24h, 7d or 28d; optional filters persona, account, provider, angle.",
  "- get_youtube_retention_curve: the audience retention curve of one of my own YouTube videos (account + video from a get_post_metrics row).",
  "- list_token_transactions: list my token ledger — every credit and debit (purchases, generation spends, refunds), newest first (optional limit, default 20, max 100).",
  "- get_persona_delete_preview: preview what deleting a persona would remove (counts + per-video download links). Read-only.",
  "- delete_persona: DESTRUCTIVE — delete a persona with all its schedules, slots, videos, and image library. No token refunds.",
  "- disconnect_account: disconnect a social account by provider and account ID (the IDs from list_social_accounts).",
  "",
  "How to work with me (agent instructions):",
  "1. Start by calling list_personas and showing me what I already have (name, language, niche). If I have none, say so.",
  "2. Ask me what I want before doing anything that costs tokens. Check get_token_balance first and warn me if the balance is low. Use an existing persona or create a new one? If new, call list_voices and show me the real voice options, then ask for: language (e.g. pt-BR, en-US), niche, video subject area, avatar (photo URL or a stock face from list_faces — every persona has a face), voice choice, video format 9:16 or 16:9, and the script style/prompt.",
  "3. Confirm the persona details with me before calling create_persona. To fix a persona later, use update_persona (never create a duplicate). Never invent a personaId: always use the id returned by list_personas or create_persona.",
  "4. For videos, confirm the script/prompt with me first, then call generate_persona_video with the full segments script and title, and call wait_for_video_tasks with the slot's taskId until it finishes. Ask me whether the videos should show the persona face or be faceless (options.videoType: 'faceless'). Share the final video URL with me.",
  "5. For publishing, call list_social_accounts first to discover my connected accounts and their IDs. Then ask for the platforms, start date, publish times, and timezone. Only schedule between 3h and 30 days in advance. Show my schedules with list_schedules on request, and use cancel_schedule to remove one.",
  "6. When I ask about my posts (what is coming next, what already went out), call list_posts and summarize the upcoming and past posts, including any failure errors.",
];

const EXPECTED_PT_PROMPT: string[] = [
  "Adicione o servidor MCP do Post Engineer na configuração do meu agente de IA.",
  "",
  "Eu já gerei minha API key em https://post-engineer.com/recipes.",
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
  "Opção remota (hospedada) — sem instalação local:",
  "Se o seu agente suporta servidores MCP remotos (por exemplo, ChatGPT), conecte-o a https://post-engineer.com/mcp em vez do comando npx acima. Ele serve as mesmas tools por Streamable HTTP com login OAuth — faça login no Post Engineer quando solicitado. Tools que leem um arquivo da sua máquina (upload_media, add_persona_image, publish_video_direct) não estão disponíveis remotamente: envie um vídeo com create_video_upload (PUT dos bytes na signed URL), depois complete_video_upload e publish_uploaded_video.",
  "",
  "Tools disponíveis após conectar:",
  "- list_personas: listar minhas personas existentes (id, nome, voz, idioma, nicho).",
  "- list_voices: listar as vozes disponíveis (catálogo vivo, nunca hardcoded).",
  "- list_faces: listar rostos de avatar padrão (id, url, nome, gênero, idade, etnia, cabelo, descrição em inglês); use a url como avatarUrl ao chamar create_persona.",
  "- create_persona: criar uma persona de IA (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9|1:1, scriptPrompt, paragraphNumber 1-5, niche).",
  "- update_persona: atualizar uma persona existente (só os campos enviados mudam).",
  "- list_persona_images: listar a biblioteca de imagens de uma persona (id, tag, description, is_primary); passe um id como imageId no generate_persona_video para forçar uma imagem específica em um vídeo.",
  "- add_persona_image: adicionar uma imagem à biblioteca de uma persona a partir de um arquivo local (JPG/JPEG, PNG ou WebP, máx 9MB). Tag e descrição opcionais guiam a seleção determinística de imagem por vídeo.",
  "- update_persona_image: atualizar a tag, a descrição ou o flag de principal de uma imagem da biblioteca.",
  "- remove_persona_image: remover uma imagem da biblioteca de uma persona.",
  "- publish_video_direct: publicar um vídeo pronto diretamente (sem geração, sem agendamento): arquivo local .mp4/.mov (máx 2GB) + account IDs do list_social_accounts; YouTube exige title, description, tags e privacyStatus; Instagram/Bluesky/LinkedIn exigem caption.",
  "- get_token_balance: ver o saldo da minha carteira de tokens.",
  "- list_prompts: listar as receitas de prompt que este servidor executa (slug, título e descrição por receita — notícia, destaque de lugar, destaque de assunto, GitHub PRs, setup completo). Chame primeiro se eu pedir um vídeo sobre um assunto em vez de um roteiro pronto.",
  "- get_prompt: buscar uma receita de prompt pelo slug (do list_prompts) como instruções validadas prontas para executar; slug desconhecido devolve um erro listando os slugs válidos.",
  "- generate_persona_video: gerar E agendar UM vídeo de persona a partir de um roteiro completo (segments: primeiro hook, depois body, por último CTA; 60-200 palavras no total, body no mínimo 30, CTA 5-20, hook 15-40 palavras terminando com pontuação final — nenhum LLM expande o roteiro; title é o rótulo do slot; personaId opcional — omita para um post faceless sem persona e informe options.videoType como 'faceless' e options.voiceId; providers mais account IDs por provider do list_social_accounts; mode 'scheduled' (padrão) agenda o vídeo com startAt datetime ISO + times [\"HH:MM\"] em timezone, mode 'asap' publica no momento em que a geração termina sem startAt/times; slot deve estar de 3h a 30 dias à frente). O vídeo é gerado e publicado automaticamente no seu slot; não há etapa separada de agendamento. Espere pelo taskId do slot com wait_for_video_tasks. Custa tokens.",
  "- validate_script: validar um roteiro em segments mecanicamente, sem gastar tokens (segments: primeiro hook, depois body, por último CTA; 60-200 palavras no total, body no mínimo 30, CTA 5-20, hook 15-40 palavras terminando com pontuação final). Retorna as contagens de palavras e a janela do hook (8-12 segundos falados). A duração medida do hook está pendente de um endpoint TTS só do hook e é informada como pendente, nunca inventada.",
  "- score_draft: pontuar um rascunho mecanicamente contra seus próprios posts medidos, sem gastar tokens. Retorna uma nota 0-100 com cada ponto explicado, a base usada e o check de publicação da rede pedida (linkedin, youtube, instagram, bluesky). Um check com falha significa: corrija o rascunho antes de agendar para essa rede. Use kind 'script' para um roteiro de vídeo: hashtags não contam e publishCheck vem null.",
  "- upload_media: enviar uma imagem local para um segmento de vídeo e obter um mediaId para o campo media do segmento (JPG, PNG ou WebP, máx. 8MB — o limite de foto do engine; asset temporário, TTL de 1 hora, então envie pouco antes de gerar).",
  "- check_media: verificar mecanicamente uma URL pública de imagem para um segmento, sem LLM e sem julgar relevância (retorna exatamente um código: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect ou media_expired — com videoAspect 9:16, 16:9 ou 1:1, uma imagem que não preenche o quadro retorna wrong_aspect com sua largura e altura medidas).",
  "- Receitas: notícias do dia viram vídeo — copie o prompt em https://post-engineer.com/recipes/daily-news ou rode /daily-news neste servidor; docs/recipes/daily-news.md tem o exemplo.",
  "- Receitas: destaque de lugar vira vídeo — copie o prompt em https://post-engineer.com/recipes/place-spotlight ou rode /place-spotlight neste servidor; docs/recipes/place-spotlight.md tem o exemplo.",
  "- Receitas: assunto em destaque vira vídeo — copie o prompt em https://post-engineer.com/recipes/subject-spotlight ou rode /subject-spotlight neste servidor; docs/recipes/subject-spotlight.md tem o exemplo.",
  "- get_video_status: conferir o status da geração com o taskId e pegar a URL do vídeo final.",
  "- get_video_task_progress: acompanhar o progresso legível por máquina de uma tarefa de vídeo ({task_id, state, progress, stage, error}); error é o motivo da falha quando state é -1, null caso contrário; use para o vídeo após generate_persona_video. Quando a tarefa pertence a um post agendado, o resultado traz postUrl, o link para a página de detalhes do post — envie no chat.",
  "- wait_for_video_tasks: esperar uma ou mais tarefas de vídeo chegarem a um estado terminal (bloqueia até cada taskId concluir ou falhar, ou o timeout acabar); use após generate_persona_video ou generate_persona_video_batch em vez de acompanhar com get_video_task_progress. Os resultados concluídos trazem postUrl, o link para a página de detalhes do post — envie no chat.",
  "- list_social_accounts: listar minhas contas sociais conectadas com os IDs necessários para agendar.",
  "- connect_account: conectar uma conta social (youtube/instagram/linkedin retornam uma URL de autorização para eu abrir no navegador em que estou logado no Post Engineer; bluesky conecta direto com handle + app password).",
  "- list_schedules: listar meus agendamentos.",
  "- list_posts: listar meus posts futuros (agendados) e passados em todas as contas conectadas (limit opcional, padrão 20, máx 500). Cada slot traz postUrl, o link para a sua página de detalhes — envie no chat.",
  "- cancel_schedule: cancelar um agendamento pelo ID.",
  "- get_slot: ver o detalhe completo de um post agendado pelo slot ID (status, título, horário, progresso, agendamento, persona).",
  "- update_slot_title: editar o título de um post agendado pendente ou pronto.",
  "- delete_slot: deletar um slot de post agendado (só slots pendentes/aguardando, prontos ou falhados; nunca o último slot do agendamento).",
  "- list_video_generations: listar meu histórico de gerações de vídeo, do mais recente ao mais antigo (limit opcional, padrão 50, máx 200).",
  "- get_video_generation: ver o detalhe de uma geração de vídeo pelo generation ID.",
  "- cancel_video_task: cancelar/remover uma tarefa de vídeo no motor pelo taskId; apenas a minha tarefa, sem reembolso de tokens.",
  "- get_post: ver o detalhe completo de um post pelo id — slot id ou generation id, o servidor resolve qual (kind \"slot\" ou \"generation\"), com o progresso ao vivo da geração. Posts de slot trazem postUrl, o link para a página de detalhes do post — envie no chat.",
  "- get_post_metrics: métricas por vídeo (views, likes, comentários, salvos; no YouTube também engaged views e ficaram para assistir) para a janela 24h, 7d ou 28d; filtros opcionais persona, account, provider, angle.",
  "- get_youtube_retention_curve: a curva de retenção de um vídeo meu do YouTube (account + video de uma linha do get_post_metrics).",
  "- list_token_transactions: listar meu extrato de tokens — todos os créditos e débitos (compras, gastos de geração, reembolsos), do mais recente ao mais antigo (limit opcional, padrão 20, máx 100).",
  "- get_persona_delete_preview: ver o que deletar uma persona removeria (contagens + links de download por vídeo). Somente leitura.",
  "- delete_persona: DESTRUTIVO — deleta uma persona com todos os agendamentos, slots, vídeos e biblioteca de imagens. Sem reembolso de tokens.",
  "- disconnect_account: desconectar uma conta social por provider e account ID (os IDs do list_social_accounts).",
  "",
  "Como trabalhar comigo (instruções para o agente):",
  "1. Comece chamando list_personas e me mostrando o que eu já tenho (nome, idioma, nicho). Se eu não tiver nenhuma, diga isso.",
  "2. Pergunte o que eu quero antes de qualquer ação que custe tokens. Consulte get_token_balance primeiro e me avise se o saldo estiver baixo. Usar uma persona existente ou criar uma nova? Se for nova, chame list_voices e me mostre as opções reais de voz, depois pergunte: idioma (ex. pt-BR, en-US), nicho/tema, avatar (foto por URL ou um rosto padrão do list_faces — toda persona tem rosto), escolha de voz, formato 9:16 ou 16:9 e o estilo/prompt do roteiro.",
  "3. Confirme os detalhes da persona comigo antes de chamar create_persona. Para corrigir uma persona depois, use update_persona (nunca crie uma duplicada). Nunca invente um personaId: use sempre o id retornado por list_personas ou create_persona.",
  "4. Para vídeos, confirme o roteiro/prompt comigo primeiro, depois chame generate_persona_video com o roteiro completo em segments e o title, e chame wait_for_video_tasks com o taskId do slot até concluir. Pergunte se os vídeos devem mostrar o rosto da persona ou ser faceless (options.videoType: 'faceless'). Compartilhe a URL final do vídeo comigo.",
  "5. Para publicar, chame list_social_accounts primeiro para descobrir minhas contas conectadas e seus IDs. Depois pergunte as plataformas, data de início, horários de publicação e timezone. Agende somente de 3h a 30 dias de antecedência. Mostre meus agendamentos com list_schedules quando eu pedir, e use cancel_schedule para remover um.",
  "6. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame list_posts e resuma os próximos e os passados, incluindo os erros de falha.",
];
