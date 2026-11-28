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
  'If your agent supports remote MCP servers (for example ChatGPT), connect it to https://post-engineer.com/mcp instead of the npx command above. It serves the same 10 tools over Streamable HTTP with OAuth sign-in — sign in to Post Engineer when prompted. The actions that read a file from your own machine (publish_video from_file, and a local imagePath or avatarPath) are not available remotely: upload a video or image with publish_video create_upload (PUT the bytes to its signed URL), then complete_upload, then publish_upload or publish_existing.',
  '',
  'Available tools after connecting (10 tools; every one takes an "action"; persona and account fields accept a name or an id). Post Engineer does not generate video: I make the media with my own tools, and these tools upload, publish, schedule and measure it:',
  '- publish_video: publish media I made: from_file (a local .mp4/.mov, max 2GB, published now), create_upload, complete_upload and publish_upload (a signed upload, video or JPEG/PNG: the bytes never pass through the server; published now), and publish_existing (a completed upload, or a local image, to every network of its accounts in one call, with mode asap or scheduled at publishAt 3h-30d ahead; a scheduled post accepts a promptVersionId for experiments). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption. Publishing needs an active account: until the account is admitted to the closed beta (request access on Discord), or while the subscription is inactive, the call fails with BETA_ACCESS_REQUIRED or SUBSCRIPTION_INACTIVE and names the contact link.',
  '- personas: list (id and name), get, create (a name and at least one publishing account; a photo is optional), update (only the given fields change; identityCard sets the identity card, or null removes it) and delete (without confirmToken it only previews what would be removed; send the confirmToken of that preview to delete).',
  '- persona_media: get_card returns the persona\'s identity card (or null); render_prompt renders a deterministic image-edit prompt from the card plus a scene (outfit, pose, setting, lighting, framing) — advice for your image tool, nothing is generated or stored.',
  `- accounts: list (my connected social accounts with the names and ids to publish with), connect (OAuth link for ${OAUTH_NETWORKS}; direct connect for ${DIRECT_NETWORKS} and ${LAST_DIRECT_NETWORK}), disconnect (by name or id), get_persona_publishing and set_persona_publishing (the accounts a persona publishes to by default), list_boards (Pinterest boards).`,
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
  'Se o seu agente suporta servidores MCP remotos (por exemplo, ChatGPT), conecte-o a https://post-engineer.com/mcp em vez do comando npx acima. Ele serve as mesmas 10 tools por Streamable HTTP com login OAuth — faça login no Post Engineer quando solicitado. As actions que leem um arquivo da sua máquina (publish_video from_file, e um imagePath ou avatarPath local) não estão disponíveis remotamente: envie um vídeo ou imagem com publish_video create_upload (PUT dos bytes na signed URL), depois complete_upload, depois publish_upload ou publish_existing.',
  '',
  'Tools disponíveis após conectar (10 tools; todas recebem um "action"; os campos de persona e de conta aceitam um nome ou um id). O Post Engineer não gera vídeo: eu faço a mídia com minhas próprias ferramentas, e estas tools enviam, publicam, agendam e medem:',
  '- publish_video: publicar a mídia que eu fiz: from_file (um .mp4/.mov local, máx 2GB, publicado na hora), create_upload, complete_upload e publish_upload (um upload assinado, vídeo ou JPEG/PNG: os bytes nunca passam pelo servidor; publicado na hora), e publish_existing (um upload concluído, ou uma imagem local, para todas as redes das contas em uma chamada, com mode asap ou scheduled em publishAt de 3h a 30d à frente; um post agendado aceita um promptVersionId para experimentos). YouTube exige title, description, tags e privacyStatus; Rumble e Fanvue title e description; as demais redes uma caption. Publicar exige conta ativa: até a conta ser liberada no beta fechado (peça acesso no Discord), ou enquanto a assinatura não está ativa, a chamada falha com BETA_ACCESS_REQUIRED ou SUBSCRIPTION_INACTIVE e mostra o link de contato.',
  '- personas: list (id e nome), get, create (um nome e ao menos uma conta de publicação; a foto é opcional), update (só os campos enviados mudam; identityCard define o cartão de identidade, ou null remove-o) e delete (sem confirmToken só mostra o que seria removido; envie o confirmToken dessa prévia para apagar).',
  '- persona_media: get_card devolve o cartão de identidade da persona (ou null); render_prompt gera um prompt determinístico de edição de imagem a partir do cartão mais uma cena (roupa, pose, cenário, iluminação, enquadramento) — orientação para a sua ferramenta de imagem, nada é gerado ou guardado.',
  `- accounts: list (minhas contas sociais conectadas com os nomes e ids para publicar), connect (link OAuth para ${OAUTH_NETWORKS}; conexão direta para ${DIRECT_NETWORKS} e ${LAST_DIRECT_NETWORK}), disconnect (por nome ou id), get_persona_publishing e set_persona_publishing (as contas em que uma persona publica por padrão), list_boards (boards do Pinterest).`,
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
