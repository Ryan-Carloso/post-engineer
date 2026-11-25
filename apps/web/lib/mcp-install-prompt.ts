import { DIRECT_CONNECT_PROVIDERS, OAUTH_CONNECT_PROVIDERS } from '@/lib/contracts/providers';
import type { Locale } from '@/lib/i18n/types';

const OAUTH_NETWORKS = OAUTH_CONNECT_PROVIDERS.join('/');
const DIRECT_NETWORKS = DIRECT_CONNECT_PROVIDERS.slice(0, -1).join(', ');
const LAST_DIRECT_NETWORK = DIRECT_CONNECT_PROVIDERS[DIRECT_CONNECT_PROVIDERS.length - 1];

interface InstallPromptCopy {
  lines: readonly string[];
  placeholder: string;
  replaceSentence: string;
  filledSentence: string;
}

const EN_LINES: readonly string[] = [
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
  'If your agent supports remote MCP servers (for example ChatGPT), connect it to https://post-engineer.com/mcp instead of the npx command above. It serves the same 17 tools over Streamable HTTP with OAuth sign-in — sign in to Post Engineer when prompted. The action that reads a file from your own machine (publish_video from_file) is not available remotely: upload a video with publish_video create_upload (PUT the bytes to its signed URL), then complete_upload and publish_upload. For images, media upload and persona_media add_image take a public https imageUrl instead of a local file.',
  '',
  'Available tools after connecting (17 tools; every one except generate_video and cancel_video takes an "action"; persona and account fields accept a name or an id):',
  '- generate_video: generate AND schedule one persona video, or a batch of 2-12 (every 6 videos with the persona face, the cheapest is free), from complete scripts. Each entry of videos has persona (a name or id; omit it for a voiceover post with no persona, then set options.videoType to \'voiceover\' and options.voiceId), accounts (account names or ids from accounts (action: list); omit them to publish to the persona\'s bound accounts), title, description and segments (first hook, then content takes in order; 60-200 words total, content at least 30, hook 25-40 words ending with terminal punctuation — no LLM expands it), plus mode \'scheduled\' (default: startAt ISO datetime + times ["HH:MM"] in timezone; slot must be 3h-30d ahead) or \'asap\' (publishes the moment generation finishes, no startAt/times). A batch needs a batchKey; one video may take an idempotencyKey. Persona and accounts are resolved by name before anything is created, and the result says what was resolved. The video is generated then auto-published at its slot; there is no separate schedule step. Costs tokens.',
  '- video_tasks: follow videos. For the final outcome, status sets waitSeconds above 0 and blocks until up to 12 tasks finish. waitSeconds 0 is only a progress snapshot: wait at least nextPollInSeconds before another snapshot. list_generations and get_generation show the generation history.',
  '- cancel_video: cancel a video that is still generating.',
  '- personas: list (id, name, voice, language, niche), get, create (a face is required: avatarUrl, or avatarPath for a local photo; at least one publishing account), update (only the given fields change) and delete (without confirmToken it only previews what would be removed; send the confirmToken of that preview to delete).',
  '- persona_media: list_faces (stock avatar faces; pass a face url as avatarUrl to personas create), list_images, add_image (a local file, or a public https imageUrl over the remote server; JPG/JPEG, PNG or WebP), update_image and remove_image for a persona\'s image library; pass an image id as imageId to generate_video to force that image.',
  '- voices: list (live catalog of house voices with descriptions; filter with gender, origin, search), preview (a short MP3 of a house voice), and clones: list_clones, create_clone (from an audio URL or a local audio file; needs explicit consent), get_clone (poll until ready), preview_clone, delete_clone.',
  `- accounts: list (my connected social accounts with the names and ids to publish with), connect (OAuth link for ${OAUTH_NETWORKS}; direct connect for ${DIRECT_NETWORKS} and ${LAST_DIRECT_NETWORK}), disconnect (by name or id), get_persona_publishing and set_persona_publishing (the accounts a persona publishes to by default), list_boards (Pinterest boards).`,
  '- tool_config: get (my saved search and stock tool configuration: which search tool and stock sources I have keys for — keys are never shown back in full) and save (replace the whole set, keys included, stored encrypted).',
  '- schedules: list, cancel (a whole schedule), get_slot, update_slot_title and delete_slot (one scheduled post).',
  '- posts: list (my upcoming and past posts; optional limit, default 20, max 500; each slot carries postUrl, the link to its detail page — send it in chat) and get (one post by slot id or generation id).',
  '- insights: post_metrics (per-video performance for window 24h, 7d or 28d, optional persona, provider, account and angle filters), last_day (views and engagement each video gained in the last 24 hours, optional persona, provider and account filters), retention_curve (the audience retention curve of one of my own YouTube videos), and share_link_create, share_link_list and share_link_revoke (a public read-only link, no login, to my metrics summary and this week\'s posts; create can limit it to one persona and set an expiry; the url is returned once).',
  '- experiments: results (compare my prompts inside each publishing account: every video records the prompt version it was written from; window 24h, 7d or 28d; a label says whether a difference is clear, indicative or not there yet).',
  '- media: check (mechanically check one public image URL for a segment; returns exactly one code: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect or media_expired) and upload (a local image, or a public https imageUrl over the remote server, becomes a mediaId; temporary, 1 hour).',
  '- billing: balance (my prepaid token balance) and transactions (the token ledger, newest first).',
  '- prompts: list (the prompts this server can run: mine and the public ones; call it first when I ask for a video about a topic) and get (one prompt by slug, as ready-to-run instructions; unverified community prompts carry a notice, verified ones do not). It also writes my own prompts, private by default: create, update (title, description, text, or visibility: public lets anyone read it, private keeps it to me), delete and restore (make an old version the current text, as a new version); versions only reads the saved texts of my prompt, newest first (pass version to read one in full). Only I can change my prompts and read their history.',
  '- check_script: validate (a segments script mechanically, without spending tokens) and score (a draft against my own measured posts, 0-100, every point explained).',
  '- publish_video: publish a ready-made video directly, no generation and no schedule: from_file (a local .mp4/.mov, max 2GB) or create_upload, complete_upload and publish_upload (a signed upload: the bytes never pass through the server). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption.',
  '- Prompts: copy one from https://post-engineer.com/recipes or run it as a slash command on this server.',
  '',
  'How to work with me (agent instructions):',
  '1. Start by calling personas (action: list) and showing me what I already have (name, language, niche). If I have none, say so.',
  '2. Ask me what I want before doing anything that costs tokens. Check billing (action: balance) first and warn me if the balance is low. Use an existing persona or create a new one? If new, call voices (action: list) and show me the real voice options, then ask for: language (e.g. pt-BR, en-US), niche, video subject area, avatar (photo URL or a stock face from persona_media (action: list_faces) — every persona has a face), voice choice, video format 9:16 or 16:9, and the script style/prompt.',
  '3. Confirm the persona details with me before calling personas (action: create). To fix a persona later, use personas (action: update) (never create a duplicate). Never invent a persona: use a name or id from personas (action: list), or the one personas (action: create) returned.',
  '4. For videos, confirm the script/prompt with me first, then call generate_video with the full segments script and title, and call video_tasks (action: status) with the taskId and waitSeconds for the final outcome. Ask me whether the videos should show the persona face or be voiceover (options.videoType: \'voiceover\'). Share the post URL with me.',
  '5. For publishing, call accounts (action: list) first to discover my connected accounts and their IDs. Then ask for the platforms, start date, publish times, and timezone. Only schedule between 3h and 30 days in advance. Show my schedules with schedules (action: list) on request, and use schedules (action: cancel) to remove one.',
  '6. When I ask about my posts (what is coming next, what already went out), call posts (action: list) and summarize the upcoming and past posts, including any failure errors.',
];

const PT_LINES: readonly string[] = [
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
  'Se o seu agente suporta servidores MCP remotos (por exemplo, ChatGPT), conecte-o a https://post-engineer.com/mcp em vez do comando npx acima. Ele serve as mesmas 17 tools por Streamable HTTP com login OAuth — faça login no Post Engineer quando solicitado. A action que lê um arquivo da sua máquina (publish_video from_file) não está disponível remotamente: envie um vídeo com publish_video create_upload (PUT dos bytes na signed URL), depois complete_upload e publish_upload. Para imagens, media upload e persona_media add_image recebem uma imageUrl https pública no lugar de um arquivo local.',
  '',
  'Tools disponíveis após conectar (17 tools; todas, exceto generate_video e cancel_video, recebem um "action"; os campos de persona e de conta aceitam um nome ou um id):',
  '- generate_video: gerar E agendar um vídeo de persona, ou um lote de 2-12 (a cada 6 vídeos com o rosto da persona, o mais barato sai de graça), a partir de roteiros completos. Cada item de videos tem persona (um nome ou id; omita para um post sem persona, voiceover, e então defina options.videoType como \'voiceover\' e options.voiceId), accounts (nomes ou ids de contas do accounts (action: list); omita para publicar nas contas vinculadas à persona), title, description e segments (primeiro o hook, depois takes de conteúdo em ordem; 60-200 palavras no total, conteúdo no mínimo 30, hook de 25-40 palavras terminando com pontuação final — nenhum LLM expande o roteiro), mais mode \'scheduled\' (padrão: startAt em ISO + times ["HH:MM"] no timezone; o slot deve estar 3h-30d à frente) ou \'asap\' (publica assim que a geração termina, sem startAt/times). Um lote precisa de um batchKey; um vídeo pode receber um idempotencyKey. Persona e contas são resolvidas por nome antes de qualquer criação, e o resultado diz o que foi resolvido. O vídeo é gerado e publicado automaticamente no slot; não há passo de agendamento separado. Gasta tokens.',
  '- video_tasks: acompanhar vídeos. Para o resultado final, status define waitSeconds acima de 0 e espera até 12 tarefas terminarem. waitSeconds 0 é só uma foto do progresso: espere pelo menos nextPollInSeconds antes de outra foto. list_generations e get_generation mostram o histórico de gerações.',
  '- cancel_video: cancelar um vídeo que ainda está sendo gerado.',
  '- personas: list (id, nome, voz, idioma, nicho), get, create (um rosto é obrigatório: avatarUrl, ou avatarPath para uma foto local; ao menos uma conta de publicação), update (só os campos enviados mudam) e delete (sem confirmToken só mostra o que seria removido; envie o confirmToken dessa prévia para apagar).',
  '- persona_media: list_faces (rostos de avatar padrão; use a url do rosto como avatarUrl no personas create), list_images, add_image (arquivo local, ou uma imageUrl https pública no servidor remoto; JPG/JPEG, PNG ou WebP), update_image e remove_image da biblioteca de imagens de uma persona; passe o id de uma imagem como imageId no generate_video para forçar essa imagem.',
  '- voices: list (catálogo vivo de vozes da casa com descrições; filtre com gender, origin, search), preview (um MP3 curto de uma voz da casa) e clones: list_clones, create_clone (a partir de uma URL de áudio ou de um arquivo de áudio local; exige consentimento explícito), get_clone (consulte até ficar ready), preview_clone, delete_clone.',
  `- accounts: list (minhas contas sociais conectadas com os nomes e ids para publicar), connect (link OAuth para ${OAUTH_NETWORKS}; conexão direta para ${DIRECT_NETWORKS} e ${LAST_DIRECT_NETWORK}), disconnect (por nome ou id), get_persona_publishing e set_persona_publishing (as contas em que uma persona publica por padrão), list_boards (boards do Pinterest).`,
  '- tool_config: get (minha configuração salva de pesquisa e stock: qual ferramenta de busca e fontes de stock tenho chaves — as chaves nunca são exibidas por inteiro) e save (substitui tudo, chaves incluídas, guardadas com criptografia).',
  '- schedules: list, cancel (um agendamento inteiro), get_slot, update_slot_title e delete_slot (um post agendado).',
  '- posts: list (meus posts futuros e passados; limit opcional, padrão 20, máx 500; cada slot traz postUrl, o link da página de detalhe — envie no chat) e get (um post por id de slot ou de geração).',
  '- insights: post_metrics (desempenho por vídeo para a janela 24h, 7d ou 28d, filtros opcionais persona, provider, account e angle), last_day (views e engajamento que cada vídeo ganhou nas últimas 24h, filtros opcionais persona, provider e account), retention_curve (a curva de retenção da audiência de um dos meus vídeos do YouTube) e share_link_create, share_link_list e share_link_revoke (um link público somente leitura, sem login, para o resumo das minhas métricas e os posts da semana; create pode limitar a uma persona e definir validade; a url é devolvida uma única vez).',
  '- experiments: results (compara meus prompts dentro de cada conta de publicação: cada vídeo guarda a versão do prompt com que foi escrito; janela 24h, 7d ou 28d; um rótulo diz se a diferença é clara, um indício ou ainda não existe).',
  '- media: check (verifica mecanicamente uma URL pública de imagem para um segmento; devolve exatamente um código: ok, blocked_403, not_image, too_small, too_large, timeout, wrong_aspect ou media_expired) e upload (uma imagem local, ou uma imageUrl https pública no servidor remoto, vira um mediaId; temporário, 1 hora).',
  '- billing: balance (meu saldo de tokens pré-pagos) e transactions (o extrato de tokens, mais recentes primeiro).',
  '- prompts: list (os prompts que este servidor executa: os meus e os públicos; chame primeiro quando eu pedir um vídeo sobre um assunto) e get (um prompt pelo slug, como instruções prontas para executar; prompts da comunidade não verificados vêm com um aviso, os verificados não). Também escreve meus próprios prompts, privados por padrão: create, update (título, descrição, texto ou visibility: public deixa qualquer pessoa ler, private mantém só comigo), delete e restore (volta um texto antigo como texto atual, em uma nova versão); versions só lê os textos salvos do meu prompt, do mais recente ao mais antigo (passe version para ler um completo). Só eu posso alterar meus prompts e ler o histórico deles.',
  '- check_script: validate (um roteiro em segments mecanicamente, sem gastar tokens) e score (um rascunho contra meus posts medidos, 0-100, cada ponto explicado).',
  '- publish_video: publicar um vídeo pronto diretamente, sem geração e sem agendamento: from_file (um .mp4/.mov local, máx 2GB) ou create_upload, complete_upload e publish_upload (um upload assinado: os bytes nunca passam pelo servidor). YouTube exige title, description, tags e privacyStatus; Rumble e Fanvue title e description; as demais redes uma caption.',
  '- Prompts: copie um em https://post-engineer.com/recipes ou rode como comando de barra neste servidor.',
  '',
  'Como trabalhar comigo (instruções para o agente):',
  '1. Comece chamando personas (action: list) e me mostrando o que eu já tenho (nome, idioma, nicho). Se eu não tiver nenhuma, diga isso.',
  '2. Pergunte o que eu quero antes de qualquer ação que custe tokens. Consulte billing (action: balance) primeiro e me avise se o saldo estiver baixo. Usar uma persona existente ou criar uma nova? Se for nova, chame voices (action: list) e me mostre as opções reais de voz, depois pergunte: idioma (ex. pt-BR, en-US), nicho/tema, avatar (foto por URL ou um rosto padrão do persona_media (action: list_faces) — toda persona tem rosto), escolha de voz, formato 9:16 ou 16:9 e o estilo/prompt do roteiro.',
  '3. Confirme os detalhes da persona comigo antes de chamar personas (action: create). Para corrigir uma persona depois, use personas (action: update) (nunca crie uma duplicada). Nunca invente uma persona: use um nome ou id de personas (action: list), ou o que personas (action: create) devolveu.',
  '4. Para vídeos, confirme o roteiro/prompt comigo primeiro, depois chame generate_video com o roteiro completo em segments e o title, e chame video_tasks (action: status) com o taskId e waitSeconds para o resultado final. Pergunte se os vídeos devem mostrar o rosto da persona ou ser voiceover (options.videoType: \'voiceover\'). Compartilhe a URL final do vídeo comigo.',
  '5. Para publicar, chame accounts (action: list) primeiro para descobrir minhas contas conectadas e seus IDs. Depois pergunte as plataformas, data de início, horários de publicação e timezone. Agende somente de 3h a 30 dias de antecedência. Mostre meus agendamentos com schedules (action: list) quando eu pedir, e use schedules (action: cancel) para remover um.',
  '6. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame posts (action: list) e resuma os próximos e os passados, incluindo os erros de falha.',
];

const COPY: Record<Locale, InstallPromptCopy> = {
  en: {
    lines: EN_LINES,
    placeholder: '<MY_API_KEY>',
    replaceSentence: 'Replace <MY_API_KEY> with my real API key.',
    filledSentence: 'The API key above is already my real key.',
  },
  pt: {
    lines: PT_LINES,
    placeholder: '<MINHA_API_KEY>',
    replaceSentence: 'Substitua <MINHA_API_KEY> pela minha API key real.',
    filledSentence: 'A API key acima já é a minha chave real.',
  },
};

export function buildInstallPrompt(locale: Locale, apiKey: string | null): string {
  const copy = COPY[locale];
  if (apiKey === null) return copy.lines.join('\n');
  const quotedPlaceholder = `"${copy.placeholder}"`;
  return copy.lines
    .map((line) =>
      line
        .replace(quotedPlaceholder, JSON.stringify(apiKey))
        .replace(copy.replaceSentence, copy.filledSentence),
    )
    .join('\n');
}
